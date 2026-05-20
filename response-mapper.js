const { getZoneLabel } = require("./constants/dhakaZones");

function mapUserAuthResponse(user) {
  const team = user.team;
  return {
    _id: user._id,
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone || "",
    departmentName: user.departmentName || "",
    profilePhoto: user.profilePhoto || "",
    team: team
      ? { _id: team._id || team, name: team.name || "" }
      : null,
    zone: user.zone || "",
    zoneLabel: getZoneLabel(user.zone),
  };
}

function mapUserProfileResponse(user) {
  return { user: mapUserAuthResponse(user) };
}

function mapUserAdminResponse(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone || "",
    departmentName: user.departmentName || "",
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

function mapUserMinimalResponse(user, includePrivate = false) {
  if (!user) return null;
  const base = {
    _id: user._id,
    name: user.isAnonymous ? "Anonymous" : user.name,
    profilePhoto: user.profilePhoto || "",
    departmentName: user.departmentName || "",
  };
  if (includePrivate) {
    base.email = user.email;
    base.phone = user.phone || "";
  }
  return base;
}

function mapIssueSummaryResponse(issue, viewerId = null, viewerRole = null) {
  const o = issue.toObject ? issue.toObject() : issue;
  const includePrivate = ["admin", "authority", "field_worker", "moderator"].includes(viewerRole);
  const viewerHasUpvoted =
    viewerId && o.upvotedBy?.some((id) => String(id) === String(viewerId));
  return {
    _id: o._id,
    issueId: o.issueId,
    title: o.title,
    description: o.description?.slice(0, 200),
    category: o.category,
    priority: o.priority,
    status: o.status,
    address: o.address,
    zone: o.zone || "",
    zoneLabel: getZoneLabel(o.zone),
    division: o.division || "",
    district: o.district || "",
    location: o.location,
    reportedBy: o.isAnonymous ? { name: "Anonymous" } : mapUserMinimalResponse(o.reportedBy, includePrivate),
    assignedTo: mapUserMinimalResponse(o.assignedTo, includePrivate),
    assignedWorkers: (o.assignedWorkers || []).map((w) => mapUserMinimalResponse(w, includePrivate)),
    assignedTeam: o.assignedTeam
      ? {
          _id: o.assignedTeam._id || o.assignedTeam,
          name: o.assignedTeam.name || "",
          zone: o.assignedTeam.zone || "",
        }
      : null,
    assignedBy: mapUserMinimalResponse(o.assignedBy, includePrivate),
    media: o.media || [],
    upvoteCount: o.upvoteCount || 0,
    viewerHasUpvoted: Boolean(viewerHasUpvoted),
    severity: o.severity,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

function mapIssueDetailResponse(issue, viewerId = null, viewerRole = null) {
  const summary = mapIssueSummaryResponse(issue, viewerId, viewerRole);
  const o = issue.toObject ? issue.toObject() : issue;
  const includePrivate = ["admin", "authority", "field_worker", "moderator"].includes(viewerRole);
  return {
    ...summary,
    description: o.description,
    subCategory: o.subCategory,
    division: o.division,
    district: o.district,
    upazila: o.upazila,
    ward: o.ward,
    landmark: o.landmark,
    isAnonymous: o.isAnonymous,
    affectedPeople: o.affectedPeople,
    resolutionNote: o.resolutionNote,
    repairProof: o.repairProof || [],
    expectedResolutionAt: o.expectedResolutionAt,
    resolvedAt: o.resolvedAt,
    verifiedAt: o.verifiedAt,
    reportedBy: o.isAnonymous ? { name: "Anonymous" } : mapUserMinimalResponse(o.reportedBy, includePrivate),
    nextActions: o.nextActions || [],
  };
}

module.exports = {
  mapUserAuthResponse,
  mapUserProfileResponse,
  mapUserAdminResponse,
  mapUserMinimalResponse,
  mapIssueSummaryResponse,
  mapIssueDetailResponse,
};
