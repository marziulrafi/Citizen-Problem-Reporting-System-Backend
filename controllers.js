const jwt = require("jsonwebtoken");
const { User, Issue, IssueHistory, Notification, Comment, Team, ActivityLog, ACTIVITY_TYPES } = require("./models");
const { createNotification } = require("./middleware");
const { canTransition, ROLE_TRANSITIONS, canAccessIssue, isWorkerOnIssue } = require("./permissions");
const {
  validateUserRegister,
  validateUserUpdateProfile,
  validateIssueCreate,
  validateIssueUpdateStatus,
  validateIssueAssign,
  validateCommentCreate,
} = require("./validator");
const {
  mapUserAuthResponse,
  mapUserProfileResponse,
  mapUserAdminResponse,
  mapIssueSummaryResponse,
  mapIssueDetailResponse,
} = require("./response-mapper");
const {
  DHAKA_ZONES,
  getZoneFromCoordinates,
  getZoneById,
  getZoneLabel,
} = require("./constants/dhakaZones");

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || "7d" });

const logActivity = async (type, actor, description, metadata = {}, issue = null, user = null, team = null) => {
  try {
    await ActivityLog.create({
      type,
      actor,
      issue,
      user,
      team,
      description,
      metadata,
    });
  } catch (err) {
    console.error("Activity log error:", err.message);
  }
};

const enrichIssue = (issue, user) => {
  const data = mapIssueDetailResponse(issue, user?._id, user?.role);
  if (!user) return data;
  const transitions =
    user.role === "admin"
      ? ROLE_TRANSITIONS.admin[issue.status] || []
      : ROLE_TRANSITIONS[user.role]?.[issue.status] || [];
  return { ...data, nextActions: transitions };
};

const enrichIssues = (issues, user) =>
  issues.map((i) => {
    const summary = mapIssueSummaryResponse(i, user?._id, user?.role);
    const transitions =
      user?.role === "admin"
        ? ROLE_TRANSITIONS.admin[i.status] || []
        : ROLE_TRANSITIONS[user?.role]?.[i.status] || [];
    return { ...summary, nextActions: transitions };
  });

const recordHistory = async (issueId, action, fromStatus, toStatus, userId, note = "") => {
  await IssueHistory.create({
    issue: issueId,
    action,
    fromStatus,
    toStatus,
    performedBy: userId,
    note,
  });
};

// ============== AUTH ==============
const register = async (req, res, next) => {
  try {
    const validatedData = validateUserRegister(req.body);
    validatedData.role = "citizen";

    const existing = await User.findOne({ email: validatedData.email });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already registered", data: null });
    }

    const user = await User.create(validatedData);
    await logActivity("user_created", user._id, `User ${user.name} registered`, { role: user.role }, null, user._id);
    
    res.status(201).json({
      success: true,
      message: "Account created successfully",
      data: { token: generateToken(user._id), user: mapUserAuthResponse(user) },
    });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required", data: null });
    }
    const user = await User.findOne({ email }).populate("team", "name");
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials", data: null });
    }
    if (user.isLocked()) {
      return res.status(423).json({ success: false, message: "Account locked. Try again after 15 minutes.", data: null });
    }
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      user.loginAttempts += 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        user.loginAttempts = 0;
      }
      await user.save();
      return res.status(401).json({ success: false, message: "Invalid credentials", data: null });
    }
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    res.json({
      success: true,
      message: "Login successful",
      data: { token: generateToken(user._id), user: mapUserAuthResponse(user) },
    });
  } catch (err) {
    next(err);
  }
};

const getMe = async (req, res) => {
  try {
    const user = await req.user.populate([
      { path: "team", select: "name zone department" },
      { path: "supervisorId", select: "name email" },
    ]);
    res.json({
      success: true,
      message: "User profile retrieved",
      data: mapUserProfileResponse(user),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to retrieve profile", data: null });
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const validatedData = validateUserUpdateProfile(req.body);
    if (req.file) validatedData.profilePhoto = `/uploads/${req.file.filename}`;

    const user = await User.findByIdAndUpdate(req.user._id, validatedData, {
      new: true,
      runValidators: true,
    }).populate(["team", "supervisorId"]);

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: mapUserProfileResponse(user),
    });
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "Valid passwords required", data: null });
    }
    const user = await User.findById(req.user._id);
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Current password is incorrect", data: null });
    }
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: "Password updated successfully", data: null });
  } catch (err) {
    next(err);
  }
};

// ============== ISSUES ==============
const buildIssueFilter = (user, query) => {
  const filter = {};
  const andConditions = [];
  const { status, category, priority, search, assignedTo, reportedBy } = query;

  if (status) filter.status = status;
  if (category) filter.category = category;
  if (priority) filter.priority = priority;
  if (reportedBy) filter.reportedBy = reportedBy;
  if (assignedTo) filter.assignedTo = assignedTo;

  if (user.role === "citizen") {
    filter.reportedBy = user._id;
  } else if (user.role === "field_worker") {
    const workerOr = [{ assignedWorkers: user._id }];
    if (user.team) workerOr.push({ assignedTeam: user.team });
    andConditions.push({ $or: workerOr });
  } else if (user.role === "authority") {
    const zoneOr = user.zone
      ? [{ zone: user.zone, status: { $in: ["verified", "reopened"] } }]
      : [{ status: { $in: ["verified", "reopened"] } }];
    andConditions.push({
      $or: [...zoneOr, { assignedBy: user._id }, { assignedTo: user._id }],
    });
  } else if (user.role === "moderator") {
    andConditions.push({
      status: { $in: ["submitted", "verified", "reopened", "pending_review", "assigned", "in_progress"] },
    });
  }

  if (search) {
    andConditions.push({
      $or: [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { issueId: { $regex: search, $options: "i" } },
      ],
    });
  }

  if (andConditions.length) filter.$and = andConditions;
  return filter;
};

const createIssue = async (req, res, next) => {
  try {
    const uploadedFiles = req.files || [];
    const validatedData = validateIssueCreate(req.body);
    const issueData = { ...validatedData, reportedBy: req.user._id };

    if (typeof issueData.severity === "string") issueData.severity = Number(issueData.severity);
    if (typeof issueData.affectedPeople === "string") issueData.affectedPeople = Number(issueData.affectedPeople);
    if (typeof issueData.isAnonymous === "string") issueData.isAnonymous = issueData.isAnonymous === "true";

    if (validatedData.latitude && validatedData.longitude) {
      const lat = parseFloat(validatedData.latitude);
      const lng = parseFloat(validatedData.longitude);
      issueData.location = { type: "Point", coordinates: [lng, lat] };
      const detected = getZoneFromCoordinates(lat, lng);
      if (detected) issueData.zone = detected.id;
    }

    issueData.division = issueData.division || "Dhaka";
    issueData.district = issueData.district || "Dhaka";

    if (uploadedFiles.length > 0) {
      issueData.media = uploadedFiles.map((file) => ({
        url: `/uploads/${file.filename}`,
        type: file.mimetype.startsWith("image") ? "image" : "document",
      }));
    }

    const issue = await Issue.create(issueData);
    req.user.statistics.issuesCreated = (req.user.statistics.issuesCreated || 0) + 1;
    await req.user.save();
    
    await recordHistory(issue._id, "created", null, "submitted", req.user._id);
    await logActivity("issue_created", req.user._id, `Created issue: ${issue.title}`, { category: issue.category, priority: issue.priority }, issue._id);
    await issue.populate("reportedBy", "name email profilePhoto");

    res.status(201).json({
      success: true,
      message: "Issue reported successfully",
      data: enrichIssue(issue, req.user),
    });
  } catch (err) {
    next(err);
  }
};

const getIssues = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, sortBy = "createdAt", order = "desc", lat, lng, radius } = req.query;
    const filter = buildIssueFilter(req.user, req.query);

    if (lat && lng && radius) {
      filter.location = {
        $near: {
          $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseFloat(radius) * 1000,
        },
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOrder = order === "asc" ? 1 : -1;

    const [issues, total] = await Promise.all([
      Issue.find(filter)
        .populate("reportedBy", "name email profilePhoto")
        .populate("assignedTo", "name email departmentName")
        .populate("assignedWorkers", "name email departmentName")
        .populate("assignedTeam", "name")
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(parseInt(limit)),
      Issue.countDocuments(filter),
    ]);

    res.json({
      success: true,
      message: "Issues retrieved successfully",
      data: {
        issues: enrichIssues(issues, req.user),
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    next(err);
  }
};

const getMyIssues = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, category, search, sortBy = "createdAt", order = "desc" } = req.query;
    const filter = { reportedBy: req.user._id };
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { issueId: { $regex: search, $options: "i" } },
      ];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOrder = order === "asc" ? 1 : -1;
    const [issues, total] = await Promise.all([
      Issue.find(filter)
        .populate("reportedBy", "name email profilePhoto")
        .populate("assignedTo", "name email departmentName")
        .populate("assignedTeam", "name")
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(parseInt(limit)),
      Issue.countDocuments(filter),
    ]);
    res.json({
      success: true,
      message: "Your issues retrieved successfully",
      data: {
        issues: enrichIssues(issues, req.user),
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    next(err);
  }
};

const getPublicFeed = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, category } = req.query;
    const filter = { status: { $ne: "closed" } };
    if (category) filter.category = category;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [issues, total] = await Promise.all([
      Issue.find(filter)
        .populate("reportedBy", "name profilePhoto")
        .populate("assignedTo", "name")
        .populate("assignedTeam", "name")
        .sort({ upvoteCount: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Issue.countDocuments(filter),
    ]);

    const viewerId = req.user?._id;
    res.json({
      success: true,
      message: "Public feed retrieved successfully",
      data: {
        issues: issues.map((i) => mapIssueSummaryResponse(i, viewerId, req.user?.role)),
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    next(err);
  }
};

const getIssueById = async (req, res, next) => {
  try {
    const issue = await Issue.findById(req.params.id)
      .populate("reportedBy", "name email profilePhoto phone address")
      .populate("assignedTo", "name email departmentName phone zone")
      .populate("assignedBy", "name email departmentName")
      .populate("assignedWorkers", "name email departmentName phone")
      .populate("moderatedBy", "name email")
      .populate("assignedTeam", "name zone")
      .populate("repairProof.uploadedBy", "name");

    if (!issue) {
      return res.status(404).json({ success: false, message: "Issue not found", data: null });
    }

    const isPublicIssue = issue.status !== "closed";
    const isAuthorizedViewer = req.user && (req.user.role === "admin" || canAccessIssue(req.user, issue));

    if (!isPublicIssue && !isAuthorizedViewer) {
      return res.status(403).json({ success: false, message: "Not allowed to view this issue", data: null });
    }

    res.json({
      success: true,
      message: "Issue retrieved successfully",
      data: enrichIssue(issue, req.user),
    });
  } catch (err) {
    next(err);
  }
};

const updateIssueStatus = async (req, res, next) => {
  try {
    const validatedData = validateIssueUpdateStatus(req.body);
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ success: false, message: "Issue not found", data: null });

    if (!canTransition(req.user.role, issue.status, validatedData.status) && req.user.role !== "admin") {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from '${issue.status}' to '${validatedData.status}'`,
        data: null,
      });
    }

    if (req.user.role === "field_worker" && !isWorkerOnIssue(req.user, issue)) {
      return res.status(403).json({ success: false, message: "Not assigned to this issue", data: null });
    }

    if (
      req.user.role === "field_worker" &&
      validatedData.status === "pending_review" &&
      !(req.files?.length || issue.repairProof?.length)
    ) {
      return res.status(400).json({
        success: false,
        message: "Upload at least one repair photo before submitting for review",
        data: null,
      });
    }

    const prevStatus = issue.status;
    issue.status = validatedData.status;
    if (validatedData.resolutionNote) issue.resolutionNote = validatedData.resolutionNote;
    if (validatedData.currentProgress) issue.currentProgress = parseInt(validatedData.currentProgress);
    if (validatedData.status === "resolved") {
      issue.resolvedAt = new Date();
      req.user.statistics.issuesResolved = (req.user.statistics.issuesResolved || 0) + 1;
      await req.user.save();
    }

    if (req.files?.length) {
      issue.repairProof.push(
        ...req.files.map((f) => ({ url: `/uploads/${f.filename}`, uploadedBy: req.user._id, note: validatedData.resolutionNote || "" }))
      );
    }

    await issue.save();
    await recordHistory(
      issue._id,
      "status_update",
      prevStatus,
      validatedData.status,
      req.user._id,
      validatedData.resolutionNote
    );
    await logActivity("status_updated", req.user._id, `Updated ${issue.issueId} from ${prevStatus} to ${validatedData.status}`, { fromStatus: prevStatus, toStatus: validatedData.status }, issue._id);
    await issue.populate(["reportedBy", "assignedTo", "assignedWorkers", "assignedTeam", "moderatedBy"]);

    if (issue.reportedBy) {
      await createNotification({
        recipient: issue.reportedBy._id || issue.reportedBy,
        issue: issue._id,
        type: validatedData.status === "resolved" ? "resolved" : "status_changed",
        title: "Issue Status Updated",
        message: `Your issue "${issue.title}" is now ${validatedData.status.replace(/_/g, " ")}.`,
      });
    }

    if (validatedData.status === "pending_review" && issue.assignedTo) {
      await createNotification({
        recipient: issue.assignedTo._id || issue.assignedTo,
        issue: issue._id,
        type: "status_changed",
        title: "Work Submitted for Review",
        message: `Repair work on "${issue.title}" is ready for your review.`,
      });
    }

    res.json({
      success: true,
      message: "Issue status updated successfully",
      data: enrichIssue(issue, req.user),
    });
  } catch (err) {
    next(err);
  }
};

// ============== MODERATION ==============
const getIssuesForModeration = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const filter = { status: { $in: ["submitted", "reopened"] } };
    
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { issueId: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [issues, total] = await Promise.all([
      Issue.find(filter)
        .populate("reportedBy", "name email profilePhoto")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Issue.countDocuments(filter),
    ]);

    res.json({
      success: true,
      message: "Issues for moderation retrieved",
      data: {
        issues: enrichIssues(issues, req.user),
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    next(err);
  }
};

const verifyIssue = async (req, res, next) => {
  try {
    const { categoryOverride, priorityOverride, moderationNote, assignedTo: authorityId } = req.body;
    const issue = await Issue.findById(req.params.id);

    if (!issue) return res.status(404).json({ success: false, message: "Issue not found", data: null });
    if (issue.status !== "submitted" && issue.status !== "reopened") {
      return res.status(400).json({ success: false, message: `Cannot verify issue in ${issue.status} status`, data: null });
    }

    if (!authorityId) {
      return res.status(400).json({
        success: false,
        message: "Select a zone authority to route this issue",
        data: null,
      });
    }

    const authority = await User.findOne({ _id: authorityId, role: "authority", isActive: true });
    if (!authority) {
      return res.status(400).json({ success: false, message: "Invalid zone authority selected", data: null });
    }

    if (issue.zone && authority.zone && issue.zone !== authority.zone) {
      return res.status(400).json({
        success: false,
        message: `Authority zone (${getZoneLabel(authority.zone)}) does not match issue zone (${getZoneLabel(issue.zone)})`,
        data: null,
      });
    }

    issue.status = "verified";
    issue.verifiedAt = new Date();
    issue.moderatedBy = req.user._id;
    issue.moderationNote = moderationNote || "";
    issue.assignedTo = authority._id;

    if (categoryOverride) issue.category = categoryOverride;
    if (priorityOverride) issue.priority = priorityOverride;

    await issue.save();
    await recordHistory(issue._id, "verified", "submitted", "verified", req.user._id, moderationNote);
    await logActivity(
      "issue_verified",
      req.user._id,
      `Verified & routed ${issue.issueId} to ${authority.name} (${getZoneLabel(authority.zone)})`,
      { moderationNote, zone: issue.zone, authorityId: authority._id },
      issue._id
    );
    await issue.populate(["reportedBy", "moderatedBy", "assignedTo"]);

    await createNotification({
      recipient: issue.reportedBy._id || issue.reportedBy,
      issue: issue._id,
      type: "verified",
      title: "Issue Verified",
      message: `Your report "${issue.title}" was verified and sent to ${getZoneLabel(authority.zone)} authority.`,
    });

    await createNotification({
      recipient: authority._id,
      issue: issue._id,
      type: "verified",
      title: "New Verified Issue in Your Zone",
      message: `"${issue.title}" needs team assignment in ${getZoneLabel(authority.zone)}.`,
    });

    res.json({
      success: true,
      message: `Issue verified and routed to ${authority.name}`,
      data: enrichIssue(issue, req.user),
    });
  } catch (err) {
    next(err);
  }
};

const rejectIssue = async (req, res, next) => {
  try {
    const { rejectionReason } = req.body;
    if (!rejectionReason || rejectionReason.trim().length < 10) {
      return res.status(400).json({ success: false, message: "Rejection reason is required (min 10 characters)", data: null });
    }

    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ success: false, message: "Issue not found", data: null });
    if (issue.status !== "submitted" && issue.status !== "reopened") {
      return res.status(400).json({ success: false, message: `Cannot reject issue in ${issue.status} status`, data: null });
    }

    issue.status = "closed";
    issue.rejectionReason = rejectionReason;
    issue.moderatedBy = req.user._id;
    await issue.save();

    await recordHistory(issue._id, "rejected", issue.status === "reopened" ? "reopened" : "submitted", "closed", req.user._id, rejectionReason);
    await logActivity("issue_rejected", req.user._id, `Rejected issue: ${issue.issueId}`, { reason: rejectionReason }, issue._id);
    await issue.populate(["reportedBy", "moderatedBy"]);

    await createNotification({
      recipient: issue.reportedBy._id || issue.reportedBy,
      issue: issue._id,
      type: "status_changed",
      title: "Issue Not Verified",
      message: `Your report "${issue.title}" was not verified. Reason: ${rejectionReason}`,
    });

    res.json({
      success: true,
      message: "Issue rejected",
      data: enrichIssue(issue, req.user),
    });
  } catch (err) {
    next(err);
  }
};

// ============== ASSIGNMENT & TEAMS ==============
const assignIssue = async (req, res, next) => {
  try {
    const { assignedTo, assignedTeam, workerIds } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ success: false, message: "Issue not found", data: null });

    if (!["verified", "reopened", "assigned"].includes(issue.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign issue while in '${issue.status}' status`,
        data: null,
      });
    }

    if (
      req.user.role === "authority" &&
      issue.assignedTo &&
      issue.assignedTo.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "This issue is assigned to another zone authority",
        data: null,
      });
    }

    if (assignedTo) {
      const authority = await User.findById(assignedTo);
      if (!authority || authority.role !== "authority") {
        return res.status(400).json({ success: false, message: "Invalid authority selected", data: null });
      }
      issue.assignedTo = assignedTo;
    }

    let teamDoc = null;
    if (assignedTeam) {
      teamDoc = await Team.findById(assignedTeam);
      if (!teamDoc || !teamDoc.isActive) {
        return res.status(400).json({ success: false, message: "Invalid or inactive team", data: null });
      }
      if (req.user.role === "authority" && teamDoc.supervisor.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "You can only assign your own zone teams", data: null });
      }
      if (issue.zone && teamDoc.zone && issue.zone !== teamDoc.zone) {
        return res.status(400).json({
          success: false,
          message: `Team zone does not match issue zone (${getZoneLabel(issue.zone)})`,
          data: null,
        });
      }
      issue.assignedTeam = assignedTeam;
      if (teamDoc.members?.length) {
        issue.assignedWorkers = teamDoc.members;
      }
    }

    if (workerIds && workerIds.length > 0) {
      const ids = Array.isArray(workerIds) ? workerIds : JSON.parse(workerIds);
      const workers = await User.find({ _id: { $in: ids }, role: "field_worker", isActive: true });
      if (!workers.length) {
        return res.status(400).json({ success: false, message: "No valid field workers found", data: null });
      }
      issue.assignedWorkers = workers.map((w) => w._id);
    }

    const hasAssignment = issue.assignedTeam || (issue.assignedWorkers && issue.assignedWorkers.length > 0);
    if (!hasAssignment) {
      return res.status(400).json({
        success: false,
        message: "Select a worker team to assign this issue",
        data: null,
      });
    }

    issue.assignedBy = req.user._id;
    if (!issue.assignedTo && req.user.role === "authority") {
      issue.assignedTo = req.user._id;
    }

    const prevStatus = issue.status;
    if (issue.status !== "assigned") {
      issue.status = "assigned";
      await recordHistory(issue._id, "assigned", prevStatus, "assigned", req.user._id);
    }

    if (issue.assignedTeam) {
      await Team.findByIdAndUpdate(issue.assignedTeam, { $inc: { "statistics.totalIssuesAssigned": 1 } });
    }

    await issue.save();
    const teamName = teamDoc?.name || (await Team.findById(issue.assignedTeam).select("name"))?.name;
    await logActivity(
      "issue_assigned",
      req.user._id,
      `Assigned issue ${issue.issueId} to ${teamName || "workers"}`,
      { workers: workerIds, team: issue.assignedTeam },
      issue._id,
      issue.assignedTeam
    );

    const notifyIds = [...new Set([...(issue.assignedWorkers || []).map((id) => String(id)), issue.assignedTo].filter(Boolean))];
    for (const rid of notifyIds) {
      await createNotification({
        recipient: rid,
        issue: issue._id,
        type: "assigned",
        title: "New Task Assignment",
        message: teamName
          ? `${teamName} has been assigned to "${issue.title}".`
          : `You have been assigned to "${issue.title}".`,
      });
    }

    if (issue.reportedBy) {
      await createNotification({
        recipient: issue.reportedBy._id || issue.reportedBy,
        issue: issue._id,
        type: "assigned",
        title: "Work Team Assigned",
        message: teamName
          ? `${teamName} has been assigned to your report: "${issue.title}". Work will begin soon.`
          : `A team has been assigned to your report: "${issue.title}". Work will begin soon.`,
      });
    }

    await issue.populate(["assignedTo", "assignedBy", "assignedWorkers", "reportedBy", "assignedTeam"]);
    res.json({
      success: true,
      message: "Issue assigned successfully",
      data: enrichIssue(issue, req.user),
    });
  } catch (err) {
    next(err);
  }
};

// ============== TEAMS ==============
const createTeam = async (req, res, next) => {
  try {
    const { name, description, zone, department, members } = req.body;
    
    if (!name || name.trim().length < 3) {
      return res.status(400).json({ success: false, message: "Team name is required (min 3 chars)", data: null });
    }

    const team = await Team.create({
      name,
      description: description || "",
      zone: zone || "",
      department: department || "",
      supervisor: req.user._id,
      members: members || [],
    });

    // Add supervisor to team
    if (!members?.includes(req.user._id.toString())) {
      team.members.push(req.user._id);
      await team.save();
    }

    // Update members' team field
    if (members && members.length > 0) {
      await User.updateMany(
        { _id: { $in: members } },
        { team: team._id, supervisorId: req.user._id }
      );
    }

    await logActivity("team_created", req.user._id, `Created team: ${name}`, { members: members?.length || 0 }, null, null, team._id);
    await team.populate(["supervisor", "members"]);

    res.status(201).json({
      success: true,
      message: "Team created successfully",
      data: { team },
    });
  } catch (err) {
    next(err);
  }
};

const getTeams = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = req.user.role === "authority" ? { supervisor: req.user._id } : {};

    const [teams, total] = await Promise.all([
      Team.find(filter)
        .populate("supervisor", "name email departmentName")
        .populate("members", "name email role")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Team.countDocuments(filter),
    ]);

    res.json({
      success: true,
      message: "Teams retrieved",
      data: {
        teams,
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    next(err);
  }
};

const updateTeam = async (req, res, next) => {
  try {
    const { name, description, zone, department, members } = req.body;
    const team = await Team.findById(req.params.teamId);

    if (!team) return res.status(404).json({ success: false, message: "Team not found", data: null });
    if (team.supervisor.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Not authorized to update this team", data: null });
    }

    if (name) team.name = name;
    if (description !== undefined) team.description = description;
    if (zone) team.zone = zone;
    if (department) team.department = department;

    if (members && Array.isArray(members)) {
      const oldMembers = team.members.map(m => m.toString());
      const newMembers = members.map(m => m.toString());
      
      // Remove old members
      const toRemove = oldMembers.filter(m => !newMembers.includes(m));
      if (toRemove.length > 0) {
        await User.updateMany({ _id: { $in: toRemove } }, { team: null, supervisorId: null });
      }
      
      // Add new members
      const toAdd = newMembers.filter(m => !oldMembers.includes(m));
      if (toAdd.length > 0) {
        await User.updateMany({ _id: { $in: toAdd } }, { team: team._id, supervisorId: req.user._id });
      }
      
      team.members = members;
    }

    await team.save();
    await team.populate(["supervisor", "members"]);

    res.json({
      success: true,
      message: "Team updated successfully",
      data: { team },
    });
  } catch (err) {
    next(err);
  }
};

const getTeamStats = async (req, res, next) => {
  try {
    const team = await Team.findById(req.params.teamId);
    if (!team) return res.status(404).json({ success: false, message: "Team not found", data: null });

    const issues = await Issue.find({
      $or: [{ assignedTeam: team._id }, { assignedWorkers: { $in: team.members } }],
    });

    const stats = {
      totalAssigned: issues.length,
      inProgress: issues.filter(i => i.status === "in_progress").length,
      completed: issues.filter(i => i.status === "resolved").length,
      pending: issues.filter(i => ["assigned", "pending_review"].includes(i.status)).length,
      memberCount: team.members.length,
    };

    res.json({
      success: true,
      message: "Team stats retrieved",
      data: { team: { ...team.toObject(), stats } },
    });
  } catch (err) {
    next(err);
  }
};

// ============== ISSUES & UPVOTES ==============
const upvoteIssue = async (req, res, next) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ success: false, message: "Issue not found", data: null });

    const idx = issue.upvotedBy.findIndex((id) => String(id) === String(req.user._id));
    if (idx >= 0) {
      issue.upvotedBy.splice(idx, 1);
      issue.upvoteCount = Math.max(0, issue.upvoteCount - 1);
    } else {
      issue.upvotedBy.push(req.user._id);
      issue.upvoteCount += 1;
    }
    await issue.save();

    res.json({
      success: true,
      message: idx >= 0 ? "Upvote removed" : "Upvoted successfully",
      data: {
        upvoteCount: issue.upvoteCount,
        viewerHasUpvoted: idx < 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

const deleteIssue = async (req, res, next) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ success: false, message: "Issue not found", data: null });

    const isOwner = String(issue.reportedBy) === String(req.user._id);
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Not allowed to delete this issue", data: null });
    }
    if (issue.status !== "submitted" && req.user.role !== "admin") {
      return res.status(400).json({ success: false, message: "Only submitted issues can be deleted", data: null });
    }

    await Issue.deleteOne({ _id: issue._id });
    res.json({ success: true, message: "Issue deleted successfully", data: null });
  } catch (err) {
    next(err);
  }
};

const getIssueHistory = async (req, res, next) => {
  try {
    const history = await IssueHistory.find({ issue: req.params.id })
      .populate("performedBy", "name role")
      .sort({ createdAt: -1 });
    res.json({
      success: true,
      message: "Issue history retrieved",
      data: { history },
    });
  } catch (err) {
    next(err);
  }
};

// ============== COMMENTS ==============
const addComment = async (req, res, next) => {
  try {
    const validated = validateCommentCreate(req.body);
    const comment = await Comment.create({
      issue: req.params.id,
      author: req.user._id,
      text: validated.text,
      isAnonymous: validated.isAnonymous === true || validated.isAnonymous === "true",
    });
    await comment.populate("author", "name role profilePhoto");

    const issue = await Issue.findById(req.params.id).select("title reportedBy assignedTo assignedWorkers");
    const notifyIds = [issue.reportedBy, issue.assignedTo, ...issue.assignedWorkers].filter(
      (id) => id && String(id) !== String(req.user._id)
    );

    for (const rid of notifyIds) {
      await createNotification({
        recipient: rid,
        issue: issue._id,
        type: "comment",
        title: "New Comment",
        message: `A new comment was added to "${issue.title}".`,
      });
    }

    res.status(201).json({
      success: true,
      message: "Comment added",
      data: { comment },
    });
  } catch (err) {
    next(err);
  }
};

const getComments = async (req, res, next) => {
  try {
    const comments = await Comment.find({ issue: req.params.id })
      .populate("author", "name role profilePhoto")
      .sort({ createdAt: -1 });
    res.json({ success: true, message: "Comments retrieved", data: { comments } });
  } catch (err) {
    next(err);
  }
};

// ============== NOTIFICATIONS ==============
const getNotifications = async (req, res, next) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ recipient: req.user._id })
        .populate("issue", "title issueId status")
        .sort({ createdAt: -1 })
        .limit(50),
      Notification.countDocuments({ recipient: req.user._id, isRead: false }),
    ]);
    res.json({
      success: true,
      message: "Notifications retrieved",
      data: { notifications, unreadCount },
    });
  } catch (err) {
    next(err);
  }
};

const markNotificationRead = async (req, res, next) => {
  try {
    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { isRead: true },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: "Notification not found", data: null });
    }
    res.json({ success: true, message: "Notification marked as read", data: null });
  } catch (err) {
    next(err);
  }
};

const markAllNotificationsRead = async (req, res, next) => {
  try {
    await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true, message: "All notifications marked as read", data: null });
  } catch (err) {
    next(err);
  }
};

// ============== DASHBOARDS & ANALYTICS ==============
const getDashboardStats = async (req, res, next) => {
  try {
    const role = req.user.role;
    let issueFilter = {};

    if (role === "authority") {
      const zoneOr = req.user.zone
        ? [{ zone: req.user.zone, status: { $in: ["verified", "reopened"] } }]
        : [{ status: { $in: ["verified", "reopened"] } }];
      issueFilter = {
        $or: [...zoneOr, { assignedBy: req.user._id }, { assignedTo: req.user._id }],
      };
    } else if (role === "field_worker") {
      const workerOr = [{ assignedWorkers: req.user._id }];
      if (req.user.team) workerOr.push({ assignedTeam: req.user.team });
      issueFilter = { $or: workerOr };
    } else if (role === "moderator") {
      issueFilter = { status: { $in: ["submitted", "reopened", "pending_review"] } };
    }

    const [
      totalIssues,
      openIssues,
      resolvedIssues,
      totalUsers,
      byStatus,
      byCategory,
      recentActivity,
    ] = await Promise.all([
      Issue.countDocuments(role === "admin" ? {} : issueFilter),
      Issue.countDocuments({
        ...(role === "admin" ? {} : issueFilter),
        status: { $nin: ["resolved", "closed"] },
      }),
      Issue.countDocuments({
        ...(role === "admin" ? {} : issueFilter),
        status: { $in: ["resolved", "closed"] },
      }),
      role === "admin" ? User.countDocuments() : Promise.resolve(0),
      Issue.aggregate([
        ...(role === "admin" ? [] : [{ $match: issueFilter }]),
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Issue.aggregate([
        ...(role === "admin" ? [] : [{ $match: issueFilter }]),
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ]),
      ActivityLog.find(role === "admin" ? {} : { actor: req.user._id })
        .populate("actor", "name role")
        .sort({ createdAt: -1 })
        .limit(20),
    ]);

    res.json({
      success: true,
      message: "Dashboard stats retrieved",
      data: {
        stats: {
          totalIssues,
          openIssues,
          resolvedIssues,
          totalUsers,
          byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
          byCategory: Object.fromEntries(byCategory.map((c) => [c._id, c.count])),
        },
        recentActivity,
      },
    });
  } catch (err) {
    next(err);
  }
};

const getAllUsers = async (req, res, next) => {
  try {
    const { role, page = 1, limit = 20, search } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      User.find(filter)
        .select("-password")
        .populate("team", "name")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      message: "Users retrieved successfully",
      data: {
        users: users.map(mapUserAdminResponse),
        pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    next(err);
  }
};

const toggleUserStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found", data: null });
    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "Cannot deactivate yourself", data: null });
    }
    user.isActive = !user.isActive;
    await user.save();
    res.json({
      success: true,
      message: `User ${user.isActive ? "activated" : "deactivated"} successfully`,
      data: { user: mapUserAdminResponse(user) },
    });
  } catch (err) {
    next(err);
  }
};

const updateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    const { ROLES } = require("./models");
    if (!ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role", data: null });
    }
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { role },
      { new: true, runValidators: true }
    ).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found", data: null });
    res.json({
      success: true,
      message: "User role updated",
      data: { user: mapUserAdminResponse(user) },
    });
  } catch (err) {
    next(err);
  }
};

const getWorkers = async (req, res, next) => {
  try {
    let filter = { role: "field_worker", isActive: true };
    
    if (req.user.role === "authority") {
      filter.team = req.user.team;
    }

    const workers = await User.find(filter)
      .select("name email departmentName phone team")
      .populate("team", "name");
    
    res.json({ success: true, message: "Workers retrieved", data: { workers } });
  } catch (err) {
    next(err);
  }
};

const getDhakaZones = async (_req, res) => {
  res.json({
    success: true,
    message: "Dhaka zones retrieved",
    data: { zones: DHAKA_ZONES },
  });
};

const getZoneAuthorities = async (req, res, next) => {
  try {
    const { zone } = req.query;
    const filter = { role: "authority", isActive: true };
    if (zone) filter.zone = zone;

    const authorities = await User.find(filter)
      .select("name email zone departmentName phone")
      .sort({ zone: 1, name: 1 });

    res.json({
      success: true,
      message: "Zone authorities retrieved",
      data: {
        authorities: authorities.map((a) => ({
          _id: a._id,
          name: a.name,
          email: a.email,
          zone: a.zone,
          zoneLabel: getZoneLabel(a.zone),
          departmentName: a.departmentName,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

const getCategoryStats = async (_req, res, next) => {
  try {
    const [stats, totalIssues, resolvedIssues] = await Promise.all([
      Issue.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]),
      Issue.countDocuments(),
      Issue.countDocuments({ status: { $in: ["resolved", "closed"] } }),
    ]);
    res.json({
      success: true,
      message: "Category stats retrieved",
      data: {
        categories: Object.fromEntries(stats.map((s) => [s._id, s.count])),
        totalIssues,
        resolvedIssues,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  // Auth
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  // Issues
  createIssue,
  getIssues,
  getMyIssues,
  getPublicFeed,
  getIssueById,
  updateIssueStatus,
  assignIssue,
  upvoteIssue,
  deleteIssue,
  getIssueHistory,
  // Moderation
  getIssuesForModeration,
  verifyIssue,
  rejectIssue,
  // Teams
  createTeam,
  getTeams,
  updateTeam,
  getTeamStats,
  // Comments
  addComment,
  getComments,
  // Notifications
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  // Analytics
  getDashboardStats,
  getAllUsers,
  toggleUserStatus,
  updateUserRole,
  getWorkers,
  getCategoryStats,
  getDhakaZones,
  getZoneAuthorities,
};
