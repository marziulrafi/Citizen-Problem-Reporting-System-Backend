const STAFF_ROLES = ["admin", "authority", "field_worker", "moderator"];

const isStaff = (role) => STAFF_ROLES.includes(role);

const isWorkerOnIssue = (issue, userId) =>
  (issue.assignedWorkers || []).some(
    (w) => String(w?._id || w) === String(userId)
  );

const isAuthorityOnIssue = (issue, userId) =>
  String(issue.assignedTo?._id || issue.assignedTo) === String(userId) ||
  String(issue.assignedBy?._id || issue.assignedBy) === String(userId);

const canManageIssue = (user, issue) => {
  if (!user) return false;
  if (user.role === "admin" || user.role === "moderator") return true;
  if (user.role === "authority") {
    return (
      isAuthorityOnIssue(issue, user._id) ||
      ["verified", "reopened"].includes(issue.status)
    );
  }
  if (user.role === "field_worker") return isWorkerOnIssue(issue, user._id);
  return false;
};

const assertCanUpdateStatus = (user, issue, nextStatus) => {
  if (user.role === "admin") return null;
  if (user.role === "field_worker") {
    if (!isWorkerOnIssue(issue, user._id)) {
      return "You are not assigned to this issue";
    }
    return null;
  }
  if (user.role === "authority") {
    if (!isAuthorityOnIssue(issue, user._id)) {
      return "This issue is not under your authority";
    }
    return null;
  }
  return null;
};

module.exports = {
  STAFF_ROLES,
  isStaff,
  isWorkerOnIssue,
  isAuthorityOnIssue,
  canManageIssue,
  assertCanUpdateStatus,
};
