import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Transaction } from "../models/transaction.model.js";

const buyStock = asyncHandler(async (req, res) => {
  const stockSymbol = (
    req.body.symbol ||
    req.body.stockSymbol ||
    "UNKNOWN"
  ).toUpperCase();
  const quantity = Number(
    req.body.quantity || req.body.shares || req.body.tradeQuantity || 1
  );
  const price = Number(req.body.price || 150);

  const totalCost = quantity * price;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(req.user._id).session(session);
    if (user.walletBalance < totalCost) throw new Error("Insufficient funds.");

    const existingStock = user.portfolio.find(
      (item) => item.stockSymbol === stockSymbol
    );

    if (existingStock) {
      await User.updateOne(
        { _id: req.user._id, "portfolio.stockSymbol": stockSymbol },
        {
          $inc: { "portfolio.$.quantity": quantity, walletBalance: -totalCost },
        },
        { session }
      );
    } else {
      await User.updateOne(
        { _id: req.user._id },
        {
          $inc: { walletBalance: -totalCost },
          $push: { portfolio: { stockSymbol, quantity, averagePrice: price } },
        },
        { session }
      );
    }

    await Transaction.create(
      [
        {
          user: req.user._id,
          type: "BUY",
          stockSymbol,
          quantity,
          price,
          totalAmount: totalCost,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    const freshUser = await User.findById(req.user._id);
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          {
            walletBalance: freshUser.walletBalance,
            portfolio: freshUser.portfolio,
          },
          `Successfully bought ${stockSymbol}`
        )
      );
  } catch (error) {
    await session.abortTransaction();
    throw new ApiError(400, error?.message || "Trade failed!");
  } finally {
    session.endSession();
  }
});

const sellStock = asyncHandler(async (req, res) => {
  const stockSymbol = (
    req.body.symbol ||
    req.body.stockSymbol ||
    "UNKNOWN"
  ).toUpperCase();
  const sharesToSell = Number(req.body.quantity || req.body.shares || 1);
  const price = Number(req.body.price || 150);

  const earnings = sharesToSell * price;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(req.user._id).session(session);
    const ownedStock = user.portfolio.find(
      (item) => item.stockSymbol === stockSymbol
    );

    if (!ownedStock) throw new Error(`You don't own any ${stockSymbol}.`);
    if (ownedStock.quantity < sharesToSell)
      throw new Error(`Not enough shares to sell.`);

    if (ownedStock.quantity === sharesToSell) {
      await User.updateOne(
        { _id: req.user._id },
        {
          $inc: { walletBalance: earnings },
          $pull: { portfolio: { stockSymbol: stockSymbol } },
        },
        { session }
      );
    } else {
      await User.updateOne(
        { _id: req.user._id, "portfolio.stockSymbol": stockSymbol },
        {
          $inc: {
            "portfolio.$.quantity": -sharesToSell,
            walletBalance: earnings,
          },
        },
        { session }
      );
    }

    await Transaction.create(
      [
        {
          user: req.user._id,
          type: "SELL",
          stockSymbol,
          quantity: sharesToSell,
          price,
          totalAmount: earnings,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    const freshUser = await User.findById(req.user._id);
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          {
            walletBalance: freshUser.walletBalance,
            portfolio: freshUser.portfolio,
          },
          `Successfully sold ${stockSymbol}`
        )
      );
  } catch (error) {
    await session.abortTransaction();
    throw new ApiError(400, error?.message || "Trade failed!");
  } finally {
    session.endSession();
  }
});

const getPortfolio = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "walletBalance portfolio"
  );
  if (!user) throw new ApiError(404, "User not found");

  let totalInvestedValue = 0;
  user.portfolio.forEach((stock) => {
    if (stock.stockSymbol) {
      totalInvestedValue += (stock.quantity || 0) * (stock.averagePrice || 150);
    }
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        walletBalance: user.walletBalance,
        totalInvestedValue,
        totalNetWorth: user.walletBalance + totalInvestedValue,
        portfolio: user.portfolio.filter((s) => s.stockSymbol),
      },
      "Portfolio fetched"
    )
  );
});

const getHistory = asyncHandler(async (req, res) => {
  const transactions = await Transaction.find({ user: req.user._id }).sort({
    createdAt: -1,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, transactions, "History fetched"));
});

export { buyStock, sellStock, getPortfolio, getHistory };
