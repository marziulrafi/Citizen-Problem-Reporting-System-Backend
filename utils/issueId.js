const { Issue, Counter } = require("../models");

async function syncIssueCounter() {
  const year = new Date().getFullYear();
  const prefix = `ISSUE-${year}-`;
  const latest = await Issue.findOne(
    { issueId: { $regex: `^ISSUE-${year}-` } },
    { issueId: 1 },
    { sort: { issueId: -1 } }
  ).lean();

  if (latest?.issueId?.startsWith(prefix)) {
    const num = parseInt(latest.issueId.slice(prefix.length), 10);
    if (!Number.isNaN(num)) {
      await Counter.findByIdAndUpdate(`issue-${year}`, { $max: { seq: num } }, { upsert: true });
    }
  }
}

async function generateIssueId() {
  const year = new Date().getFullYear();
  const counter = await Counter.findByIdAndUpdate(
    `issue-${year}`,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `ISSUE-${year}-${String(counter.seq).padStart(6, "0")}`;
}

module.exports = { generateIssueId, syncIssueCounter };
