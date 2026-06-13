const { analyzeIssue } = require("../services/aiService");
const { sendSuccess, sendError } = require("../utils/apiResponse");

const analyzeIssuePreview = async (req, res, next) => {
  try {
    const { title = "", description = "" } = req.body || {};
    if (String(description).trim().length < 20) {
      return sendError(res, {
        status: 400,
        message: "Description must be at least 20 characters for AI analysis",
      });
    }
    const analysis = await analyzeIssue({ title, description });
    return sendSuccess(res, {
      message: analysis.aiEnabled
        ? "AI analysis complete"
        : "AI unavailable — using safe defaults",
      data: { analysis },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { analyzeIssuePreview };
