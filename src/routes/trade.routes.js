import { Router } from "express";
import mongoose from "mongoose";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { User } from "../models/user.model.js";
import { createClient } from "redis";
import YahooFinance from "yahoo-finance2";

// --- GRACEFUL REDIS CONNECTION ---
let redisClient;
(async () => {
  redisClient = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
  });
  redisClient.on("error", (err) => console.log("Redis Client Error (bypassing cache):", err.message));
  try {
    await redisClient.connect();
    console.log("⚡ Redis cache connected successfully!");
  } catch (err) {
    redisClient = null;
  }
})();

// --- REAL WALL STREET CONNECTION ---
const yahooFinance = new YahooFinance();

const router = Router();

// --- 1. GET LIVE PRICE (Using Blazing-Fast Redis Cache) ---
router.route("/price/:symbol").get(async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    
    // 1. Check Redis Cache First
    if (redisClient && redisClient.isOpen) {
      const cachedPrice = await redisClient.get(`price:${symbol}`);
      if (cachedPrice) {
        console.log(`⚡ CACHE HIT! Served ${symbol} price directly from Redis memory.`);
        return res.status(200).json({ price: Number(cachedPrice) });
      }
    }

    // 2. Cache Miss -> Fetch securely from Wall Street API
    console.log(`🐢 CACHE MISS! Fetching ${symbol} from Yahoo Finance API...`);
    const quote = await yahooFinance.quote(symbol);
    const livePrice = quote.regularMarketPrice;

    // 3. Save to Redis Cache (Expire after 10 seconds to drastically reduce API load)
    if (redisClient && redisClient.isOpen) {
        await redisClient.setEx(`price:${symbol}`, 10, livePrice.toString());
    }

    res.status(200).json({ price: livePrice });
  } catch (error) {
    console.error("YAHOO FINANCE ERROR:", error);
    res.status(500).json({ error: "Failed to fetch live market data." });
  }
});

// ============================================================
// 2. EXECUTE A BUY ORDER (with MongoDB ACID Transaction)
// ============================================================
// WHY: Without a transaction, two rapid-fire requests can both read
// the same balance before either saves, allowing a user to spend
// more money than they have ("double-spend" race condition).
// The session lock ensures only one write completes at a time.
// ============================================================
router.route("/buy").post(verifyJWT, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { symbol, quantity } = req.body;

    // Input validation
    if (!symbol || !quantity || quantity <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Invalid trade parameters." });
    }

    // Fetch the REAL live price securely on the backend
    const quote = await yahooFinance.quote(symbol);
    const livePrice = quote.regularMarketPrice;
    const totalCost = Number(quantity) * livePrice;

    // Read user WITHIN the transaction session (locks the document)
    const user = await User.findById(req.user._id).session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "User not found." });
    }

    if (user.walletBalance < totalCost) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Insufficient Buying Power." });
    }

    // Deduct balance
    user.walletBalance -= totalCost;

    // Update or create portfolio entry
    const existingStockIndex = user.portfolio.findIndex(
      (s) => s.stockSymbol === symbol.toUpperCase()
    );

    if (existingStockIndex >= 0) {
      const oldQty = user.portfolio[existingStockIndex].quantity;
      const oldPrice = user.portfolio[existingStockIndex].averagePrice;
      const newQty = oldQty + Number(quantity);
      user.portfolio[existingStockIndex].averagePrice =
        (oldQty * oldPrice + Number(quantity) * livePrice) / newQty;
      user.portfolio[existingStockIndex].quantity = newQty;
    } else {
      user.portfolio.push({
        stockSymbol: symbol.toUpperCase(),
        quantity: Number(quantity),
        averagePrice: Number(livePrice),
      });
    }

    // Save within transaction — if another request is mid-flight, this will
    // detect the version conflict and abort one of them (no double-spend)
    await user.save({ session });

    // Commit the transaction — only NOW is the balance permanently deducted
    await session.commitTransaction();
    session.endSession();

    console.log(`✅ [TXN] BUY committed: ${quantity}x ${symbol} @ $${livePrice.toFixed(2)}`);

    res.status(200).json({
      message: `Successfully bought ${quantity} shares of ${symbol.toUpperCase()} at $${livePrice.toFixed(2)}!`,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    // If anything fails, abort — balance is never deducted
    await session.abortTransaction();
    session.endSession();
    console.error("BUY ERROR (transaction rolled back):", error.message);
    res.status(500).json({ error: "Trade execution failed. Transaction rolled back." });
  }
});

// ============================================================
// 3. EXECUTE A SELL ORDER (with MongoDB ACID Transaction)
// ============================================================
router.route("/sell").post(verifyJWT, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { symbol, quantity } = req.body;

    // Input validation
    if (!symbol || !quantity || quantity <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Invalid trade parameters." });
    }

    // Fetch the REAL live price securely on the backend
    const quote = await yahooFinance.quote(symbol);
    const livePrice = quote.regularMarketPrice;

    // Read user WITHIN the transaction session
    const user = await User.findById(req.user._id).session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "User not found." });
    }

    const stockIndex = user.portfolio.findIndex(
      (s) => s.stockSymbol === symbol.toUpperCase()
    );

    if (stockIndex === -1 || user.portfolio[stockIndex].quantity < quantity) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Not enough shares to sell!" });
    }

    // Credit balance
    const saleValue = Number(quantity) * livePrice;
    user.walletBalance += saleValue;
    user.portfolio[stockIndex].quantity -= Number(quantity);

    // Remove stock from portfolio if fully liquidated
    if (user.portfolio[stockIndex].quantity === 0) {
      user.portfolio.splice(stockIndex, 1);
    }

    await user.save({ session });

    // Commit — only now is the balance permanently credited
    await session.commitTransaction();
    session.endSession();

    console.log(`✅ [TXN] SELL committed: ${quantity}x ${symbol} @ $${livePrice.toFixed(2)}`);

    res.status(200).json({
      message: `Successfully sold ${quantity} shares of ${symbol.toUpperCase()} at $${livePrice.toFixed(2)}!`,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("SELL ERROR (transaction rolled back):", error.message);
    res.status(500).json({ error: "Sell execution failed. Transaction rolled back." });
  }
});

export default router;
