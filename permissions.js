const PERMISSIONS = {
  citizen: [
    "issue:create",
    "issue:read_own",
    "issue:upvote",
    "issue:comment",
    "issue:delete_own",
    "profile:read",
    "profile:update",
  ],
  moderator: [
    "issue:read_all",
    "issue:verify",
    "issue:reject",
    "issue:moderate",
    "issue:categorize",
    "comment:moderate",
    "dashboard:moderate",
    "report:view",
  ],
  authority: [
    "issue:read_verified",
    "issue:assign_team",
    "issue:assign_worker",
    "issue:read_all",
    "issue:update_priority",
    "worker:manage",
    "worker:view",
    "team:manage",
    "team:view",
    "dashboard:authority",
    "report:view",
    "issue:monitor",
  ],
  field_worker: [
    "issue:read_assigned",
    "issue:update_status",
    "issue:upload_proof",
    "issue:add_note",
    "dashboard:worker",
    "profile:read",
    "profile:update",
  ],
  admin: ["*"],
};

const ROLE_TRANSITIONS = {
  citizen: {},
  moderator: {
    submitted: ["verified", "closed"],
    reopened: ["verified", "closed"],
  },
  authority: {
    verified: ["assigned", "closed"],
    assigned: ["in_progress", "closed"],
    in_progress: ["pending_review", "closed"],
    pending_review: ["resolved", "reopened", "closed"],
    reopened: ["assigned", "in_progress", "closed"],
  },
  field_worker: {
    assigned: ["in_progress"],
    in_progress: ["pending_review", "assigned"],
  },
  admin: {
    submitted: ["verified", "closed"],
    verified: ["assigned", "closed"],
    assigned: ["in_progress", "closed"],
    in_progress: ["pending_review", "closed"],
    pending_review: ["resolved", "reopened", "closed"],
    resolved: ["closed", "reopened"],
    reopened: ["assigned", "in_progress", "closed"],
    closed: ["reopened"],
  },
};

function hasPermission(role, permission) {
  const perms = PERMISSIONS[role] || [];
  return perms.includes("*") || perms.includes(permission);
}

function canTransition(role, fromStatus, toStatus) {
  if (role === "admin") return true;
  const allowed = ROLE_TRANSITIONS[role]?.[fromStatus] || [];
  return allowed.includes(toStatus);
}

function canAccessIssue(user, issue) {
  if (user.role === "admin") return true;
  if (user.role === "citizen") return issue.reportedBy.toString() === user._id.toString();
  if (user.role === "moderator") return true;
  if (user.role === "authority") {
    return issue.assignedTo?.toString() === user._id.toString() || 
           issue.assignedTeam?.toString() === user.team?.toString();
  }
  if (user.role === "field_worker") {
    const onWorkers = issue.assignedWorkers?.some((w) => w.toString() === user._id.toString());
    const onTeam =
      user.team &&
      issue.assignedTeam &&
      issue.assignedTeam.toString() === user.team.toString();
    return onWorkers || onTeam;
  }
  return false;
}

function isWorkerOnIssue(user, issue) {
  if (!user || user.role !== "field_worker" || !issue) return false;
  const onWorkers = issue.assignedWorkers?.some((w) => {
    const id = w._id || w;
    return id.toString() === user._id.toString();
  });
  const teamId = issue.assignedTeam?._id || issue.assignedTeam;
  const userTeamId = user.team?._id || user.team;
  const onTeam = userTeamId && teamId && teamId.toString() === userTeamId.toString();
  return onWorkers || onTeam;
}

module.exports = {
  PERMISSIONS,
  ROLE_TRANSITIONS,
  hasPermission,
  canTransition,
  canAccessIssue,
  isWorkerOnIssue,
};
