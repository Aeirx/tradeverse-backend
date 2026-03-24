import axios from "axios";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const getAiInsight = asyncHandler(async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res
      .status(400)
      .json({ error: "Please provide a question for the AI." });
  }

  console.log(`🤖 [Node.js] Calling Python AI Brain to ask: "${query}"`);

  try {
    // 1. Make the HTTP POST request to your Python FastAPI server
    const aiResponse = await axios.post("http://127.0.0.1:8001/search", {
      text: query,
    });

    console.log("🧠 AI Answer Received:", aiResponse.data);

    // 2. Package the AI's answer and send it to the user/frontend
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          aiResponse.data,
          "AI Brain responded successfully!"
        )
      );
  } catch (error) {
    console.error("🚨 AI Service Error:", error.message);
    return res
      .status(500)
      .json({ error: "The AI Brain is currently asleep or offline." });
  }
});

export { getAiInsight };
