import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const session = {
    startTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    endSession: vi.fn(),
  };

  return {
    session,
    quote: vi.fn(),
    updateOne: vi.fn(),
    transactionCreate: vi.fn(),
    transactionFind: vi.fn(),
    user: null,
    history: [],
  };
});

vi.mock("mongoose", () => ({
  default: {
    startSession: vi.fn(() => mocks.session),
  },
}));

vi.mock("yahoo-finance2", () => ({
  default: vi.fn(function YahooFinanceMock() {
    return {
      quote: mocks.quote,
    };
  }),
}));

vi.mock("../src/models/user.model.js", () => ({
  User: {
    findById: vi.fn(() => ({
      session: vi.fn(() => Promise.resolve(mocks.user)),
      select: vi.fn(() => Promise.resolve(mocks.user)),
      _id: mocks.user?._id,
      walletBalance: mocks.user?.walletBalance,
      portfolio: mocks.user?.portfolio,
    })),
    updateOne: (...args) => mocks.updateOne(...args),
  },
}));

vi.mock("../src/models/transaction.model.js", () => ({
  Transaction: {
    create: (...args) => mocks.transactionCreate(...args),
    find: vi.fn(() => ({
      sort: vi.fn(() => Promise.resolve(mocks.history)),
    })),
  },
}));

const { buyStock, sellStock, getPortfolio, getHistory } = await import(
  "../src/controllers/trade.controller.js"
);

const createResponse = () => {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
};

const runController = async (controller, body = {}) => {
  const req = {
    body,
    user: { _id: "user-1" },
  };
  const res = createResponse();
  const next = vi.fn();

  await controller(req, res, next);

  return { res, next };
};

const applyUserUpdate = (query, update) => {
  if (update.$inc?.walletBalance) {
    mocks.user.walletBalance += update.$inc.walletBalance;
  }

  if (update.$inc?.["portfolio.$.quantity"]) {
    const item = mocks.user.portfolio.find(
      (stock) => stock.stockSymbol === query["portfolio.stockSymbol"]
    );
    item.quantity += update.$inc["portfolio.$.quantity"];
  }

  if (update.$set?.["portfolio.$.averagePrice"]) {
    const item = mocks.user.portfolio.find(
      (stock) => stock.stockSymbol === query["portfolio.stockSymbol"]
    );
    item.averagePrice = update.$set["portfolio.$.averagePrice"];
  }

  if (update.$push?.portfolio) {
    mocks.user.portfolio.push(update.$push.portfolio);
  }

  if (update.$pull?.portfolio) {
    mocks.user.portfolio = mocks.user.portfolio.filter(
      (stock) => stock.stockSymbol !== update.$pull.portfolio.stockSymbol
    );
  }
};

beforeEach(() => {
  mocks.user = {
    _id: "user-1",
    walletBalance: 1000,
    portfolio: [],
  };
  mocks.history = [];
  mocks.quote.mockResolvedValue({ regularMarketPrice: 150 });
  mocks.updateOne.mockImplementation((query, update) => {
    applyUserUpdate(query, update);
    return Promise.resolve({ acknowledged: true });
  });
  mocks.transactionCreate.mockResolvedValue([]);

  vi.clearAllMocks();
});

describe("trade controller", () => {
  it("rejects invalid symbols", async () => {
    const { next } = await runController(buyStock, {
      symbol: "AAPL!",
      quantity: 1,
    });

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Invalid stock symbol format.",
      })
    );
  });

  it("rejects invalid quantities", async () => {
    const { next } = await runController(buyStock, {
      symbol: "AAPL",
      quantity: -5,
    });

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Invalid trade quantity. Must be a positive integer.",
      })
    );
  });

  it("buys a new holding and records the transaction", async () => {
    const { res, next } = await runController(buyStock, {
      symbol: "AAPL",
      quantity: 2,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.walletBalance).toBe(700);
    expect(res.body.data.portfolio).toEqual([
      { stockSymbol: "AAPL", quantity: 2, averagePrice: 150 },
    ]);
    expect(mocks.transactionCreate).toHaveBeenCalled();
  });

  it("recalculates weighted average price when buying more", async () => {
    mocks.user.portfolio = [
      { stockSymbol: "AAPL", quantity: 2, averagePrice: 100 },
    ];

    const { res, next } = await runController(buyStock, {
      symbol: "AAPL",
      quantity: 2,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.body.data.portfolio[0]).toEqual({
      stockSymbol: "AAPL",
      quantity: 4,
      averagePrice: 125,
    });
  });

  it("rejects buys with insufficient funds", async () => {
    const { next } = await runController(buyStock, {
      symbol: "TSLA",
      quantity: 10,
    });

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Insufficient funds.",
      })
    );
  });

  it("rejects selling more shares than owned", async () => {
    mocks.user.portfolio = [
      { stockSymbol: "AAPL", quantity: 2, averagePrice: 150 },
    ];

    const { next } = await runController(sellStock, {
      symbol: "AAPL",
      quantity: 5,
    });

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Not enough shares to sell.",
      })
    );
  });

  it("sells owned shares", async () => {
    mocks.user.portfolio = [
      { stockSymbol: "AAPL", quantity: 2, averagePrice: 150 },
    ];

    const { res, next } = await runController(sellStock, {
      symbol: "AAPL",
      quantity: 1,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.walletBalance).toBe(1150);
    expect(res.body.data.portfolio[0].quantity).toBe(1);
  });

  it("returns portfolio metrics", async () => {
    mocks.user.portfolio = [
      { stockSymbol: "AAPL", quantity: 2, averagePrice: 150 },
    ];

    const { res, next } = await runController(getPortfolio);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.data.totalInvestedValue).toBe(300);
    expect(res.body.data.totalNetWorth).toBe(1300);
  });

  it("returns trade history", async () => {
    mocks.history = [{ type: "BUY", stockSymbol: "AAPL" }];

    const { res, next } = await runController(getHistory);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.data).toEqual(mocks.history);
  });
});
