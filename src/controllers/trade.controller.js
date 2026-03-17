import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Transaction } from "../models/transaction.model.js";

const buyStock = asyncHandler(async (req, res) => {
  // 1. Get order details from the user
  const { stockSymbol, quantity, price } = req.body;

  if (!stockSymbol || !quantity || !price) {
    throw new ApiError(400, "Please provide stockSymbol, quantity, and price.");
  }

  const totalCost = Number(quantity) * Number(price);

  // 2. Initialize the Safety Bubble
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 3. Find the user INSIDE the transaction bubble
    const user = await User.findById(req.user._id).session(session);

    // 4. Check if they are too poor to buy this 😅
    if (user.walletBalance < totalCost) {
      throw new Error("Insufficient funds in wallet."); // Throws to the catch block!
    }

    // 5. Deduct the money
    user.walletBalance -= totalCost;

    // 6. Add stock to portfolio
    // (Checking if they already own this stock to just update the quantity)
    const existingStockIndex = user.portfolio.findIndex(
      (item) => item.stockSymbol === stockSymbol
    );

    if (existingStockIndex > -1) {
      // They own it already, just add more shares
      user.portfolio[existingStockIndex].quantity += Number(quantity);
    } else {
      // New stock, push it to the array
      user.portfolio.push({
        stockSymbol,
        quantity: Number(quantity),
        averagePrice: Number(price),
      });
    }

    // 7. Save the user INSIDE the transaction bubble
    await user.save({ session });

    // --- PRINT RECEIPT INSIDE BUBBLE ---
    await Transaction.create(
      [
        {
          user: req.user._id,
          type: "BUY",
          stockSymbol,
          quantity: Number(quantity),
          price: Number(price),
          totalAmount: totalCost,
        },
      ],
      { session }
    );

    // 8. Make it permanent!
    await session.commitTransaction();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          walletBalance: user.walletBalance,
          portfolio: user.portfolio,
        },
        `Successfully bought ${quantity} shares of ${stockSymbol}`
      )
    );
  } catch (error) {
    // 9. If ANYTHING fails (like insufficient funds), roll back the database
    await session.abortTransaction();
    throw new ApiError(
      400,
      error?.message || "Trade failed! Your money has been refunded."
    );
  } finally {
    session.endSession();
  }
});

const sellStock = asyncHandler(async (req, res) => {
  const { stockSymbol, quantity, price } = req.body;

  if (!stockSymbol || !quantity || !price) {
    throw new ApiError(400, "Please provide stockSymbol, quantity, and price.");
  }

  const earnings = Number(quantity) * Number(price);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(req.user._id).session(session);

    // 1. Check if they even own the stock
    const existingStockIndex = user.portfolio.findIndex(
      (item) => item.stockSymbol === stockSymbol
    );

    if (existingStockIndex === -1) {
      throw new Error(`You don't own any shares of ${stockSymbol}.`);
    }

    const ownedStock = user.portfolio[existingStockIndex];

    // 2. Check if they have enough shares to sell
    if (ownedStock.quantity < Number(quantity)) {
      throw new Error(
        `You only have ${ownedStock.quantity} shares of ${stockSymbol} to sell.`
      );
    }

    // 3. Add the cash to their wallet
    user.walletBalance += earnings;

    // 4. Deduct the shares from their portfolio
    ownedStock.quantity -= Number(quantity);

    // 5. If they sold everything, remove the stock entirely from the array
    if (ownedStock.quantity === 0) {
      user.portfolio.splice(existingStockIndex, 1);
    }

    // 6. Save and Commit the Transaction
    await user.save({ session });
    await session.commitTransaction();
    // --- PRINT RECEIPT INSIDE BUBBLE ---
    await Transaction.create(
      [
        {
          user: req.user._id,
          type: "SELL",
          stockSymbol,
          quantity: Number(quantity),
          price: Number(price),
          totalAmount: earnings,
        },
      ],
      { session }
    );

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          walletBalance: user.walletBalance,
          portfolio: user.portfolio,
        },
        `Successfully sold ${quantity} shares of ${stockSymbol}`
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
  // 1. Fetch the user's financial data (We only need the wallet and portfolio)
  const user = await User.findById(req.user._id).select(
    "walletBalance portfolio"
  );

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // 2. Calculate the Total Invested Value
  let totalInvestedValue = 0;

  // Loop through every stock they own and multiply quantity by the average price
  user.portfolio.forEach((stock) => {
    totalInvestedValue += stock.quantity * stock.averagePrice;
  });

  // 3. Calculate Total Net Worth
  const totalNetWorth = user.walletBalance + totalInvestedValue;

  // 4. Send the Dashboard Data back to the user
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        walletBalance: user.walletBalance,
        totalInvestedValue: totalInvestedValue,
        totalNetWorth: totalNetWorth,
        portfolio: user.portfolio,
      },
      "Portfolio fetched successfully"
    )
  );
});

const getHistory = asyncHandler(async (req, res) => {
  // Find all receipts for this user, sorted by newest first (-1)
  const transactions = await Transaction.find({ user: req.user._id }).sort({
    createdAt: -1,
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        transactions,
        "Transaction history fetched successfully"
      )
    );
});

export { buyStock, sellStock, getPortfolio, getHistory };
