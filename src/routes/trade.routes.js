import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { User } from "../models/user.model.js";

// --- REAL WALL STREET CONNECTION ---
import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();

const router = Router();

// --- 1. GET LIVE PRICE (Public route, no verifyJWT!) ---
router.route("/price/:symbol").get(async (req, res) => {
  try {
    const quote = await yahooFinance.quote(req.params.symbol);
    res.status(200).json({ price: quote.regularMarketPrice });
  } catch (error) {
    console.error("YAHOO FINANCE ERROR:", error);
    res.status(500).json({ error: "Failed to fetch live market data." });
  }
});

// --- 2. EXECUTE A BUY ORDER ---
router.route("/buy").post(verifyJWT, async (req, res) => {
  try {
    const { symbol, quantity } = req.body;

    // Fetch the REAL live price securely on the backend right when you click BUY
    const quote = await yahooFinance.quote(symbol);
    const livePrice = quote.regularMarketPrice;
    const totalCost = quantity * livePrice;

    const user = await User.findById(req.user._id);

    if (user.walletBalance < totalCost) {
      return res.status(400).json({ error: "Insufficient Buying Power." });
    }

    user.walletBalance -= totalCost;

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

    await user.save();

    res.status(200).json({
      message: `Successfully bought ${quantity} shares of ${symbol.toUpperCase()} at $${livePrice.toFixed(2)}!`,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    console.error("BUY ERROR:", error);
    res.status(500).json({ error: "Trade execution failed." });
  }
});

// --- 3. EXECUTE A SELL ORDER ---
router.route("/sell").post(verifyJWT, async (req, res) => {
  try {
    const { symbol, quantity } = req.body;

    // Fetch the REAL live price securely on the backend right when you click SELL
    const quote = await yahooFinance.quote(symbol);
    const livePrice = quote.regularMarketPrice;

    const user = await User.findById(req.user._id);
    const stockIndex = user.portfolio.findIndex(
      (s) => s.stockSymbol === symbol.toUpperCase()
    );

    if (stockIndex === -1 || user.portfolio[stockIndex].quantity < quantity) {
      return res.status(400).json({ error: "Not enough shares to sell!" });
    }

    const saleValue = quantity * livePrice;
    user.walletBalance += saleValue;
    user.portfolio[stockIndex].quantity -= quantity;

    if (user.portfolio[stockIndex].quantity === 0) {
      user.portfolio.splice(stockIndex, 1);
    }

    await user.save();

    res.status(200).json({
      message: `Successfully sold ${quantity} shares of ${symbol.toUpperCase()} at $${livePrice.toFixed(2)}!`,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    console.error("SELL ERROR:", error);
    res.status(500).json({ error: "Sell execution failed." });
  }
});

export default router;
