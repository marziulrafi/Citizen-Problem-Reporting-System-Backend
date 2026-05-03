const jwt = require("jsonwebtoken");
const { User, Issue, Comment, Notification, Feedback } = require("./models");
const { createNotification } = require("./middleware");
const {
    validateUserRegister,
    validateUserUpdateProfile,
    validateIssueCreate,
    validateIssueUpdateStatus,
} = require("./validators");
const {
    mapUserAuthResponse,
    mapUserProfileResponse,
    mapUserAdminResponse,
    mapIssueSummaryResponse,
} = require("./response-mapper");

const generateToken = (id) =>
    jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || "7d" });

const register = async (req, res, next) => {
    try {
        const validatedData = validateUserRegister(req.body);

        const existing = await User.findOne({ email: validatedData.email });
        if (existing) {
            return res.status(400).json({ success: false, message: "Email already registered" });
        }

        const user = await User.create(validatedData);

        res.status(201).json({
            success: true,
            message: "Account created successfully",
            data: {
                token: generateToken(user._id),
                user: mapUserAuthResponse(user),
            },
        });
    } catch (err) {
        next(err);
    }
};

const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required" });
        }
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }
        if (user.isLocked()) {
            return res.status(423).json({ success: false, message: "Account locked. Try again after 15 minutes." });
        }
        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            user.loginAttempts += 1;
            if (user.loginAttempts >= 5) {
                user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
                user.loginAttempts = 0;
            }
            await user.save();
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }
        user.loginAttempts = 0;
        user.lockUntil = undefined;
        await user.save();

        res.json({
            success: true,
            message: "Login successful",
            data: {
                token: generateToken(user._id),
                user: mapUserAuthResponse(user),
            },
        });
    } catch (err) {
        next(err);
    }
};

const getMe = async (req, res) => {
    res.json({
        success: true,
        message: "User profile retrieved",
        data: mapUserProfileResponse(req.user),
    });
};

const updateProfile = async (req, res, next) => {
    try {
        const validatedData = validateUserUpdateProfile(req.body);

        if (req.file) validatedData.profilePhoto = `/uploads/${req.file.filename}`;

        const user = await User.findByIdAndUpdate(req.user._id, validatedData, {
            new: true,
            runValidators: true,
        });

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
        const user = await User.findById(req.user._id);
        const isMatch = await user.matchPassword(currentPassword);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Current password is incorrect" });
        }
        user.password = newPassword;
        await user.save();
        res.json({
            success: true,
            message: "Password updated successfully",
            data: null,
        });
    } catch (err) {
        next(err);
    }
};

const createIssue = async (req, res, next) => {
    try {
        const uploadedFiles = req.files || [];
        const hasImage = uploadedFiles.some((file) => file.mimetype.startsWith("image"));
        if (!hasImage) {
            return res.status(400).json({
                success: false,
                message: "At least one photo is required",
            });
        }

        const validatedData = validateIssueCreate(req.body);

        const issueData = {
            ...validatedData,
            reportedBy: req.user._id,
        };

        if (typeof issueData.severity === "string") issueData.severity = Number(issueData.severity);
        if (typeof issueData.affectedPeople === "string") issueData.affectedPeople = Number(issueData.affectedPeople);
        if (typeof issueData.isAnonymous === "string") issueData.isAnonymous = issueData.isAnonymous === "true";

        if (validatedData.latitude && validatedData.longitude) {
            issueData.location = {
                type: "Point",
                coordinates: [parseFloat(validatedData.longitude), parseFloat(validatedData.latitude)],
            };
            delete issueData.latitude;
            delete issueData.longitude;
        }

        if (uploadedFiles.length > 0) {
            issueData.media = uploadedFiles.map((file) => ({
                url: `/uploads/${file.filename}`,
                type: file.mimetype.startsWith("image")
                    ? "image"
                    : file.mimetype.startsWith("video")
                        ? "video"
                        : file.mimetype.startsWith("audio")
                            ? "audio"
                            : "document",
            }));
        }

        const issue = await Issue.create(issueData);
        await issue.populate("reportedBy", "name profilePhoto email");

        res.status(201).json({
            success: true,
            message: "Issue reported successfully",
            data: mapIssueDetailResponse(issue),
        });
    } catch (err) {
        next(err);
    }
};

const getIssues = async (req, res, next) => {
    try {
        const {
            status, category, priority, page = 1, limit = 10,
            lat, lng, radius, search, assignedTo, reportedBy,
            sortBy = "createdAt", order = "desc",
        } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (category) filter.category = category;
        if (priority) filter.priority = priority;
        if (assignedTo) filter.assignedTo = assignedTo;
        if (reportedBy) filter.reportedBy = reportedBy;

        if (req.user.role === "citizen" && !req.query.public) {
            filter.reportedBy = req.user._id;
        }

        if (lat && lng && radius) {
            filter.location = {
                $near: {
                    $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
                    $maxDistance: parseFloat(radius) * 1000,
                },
            };
        }

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
                .sort({ [sortBy]: sortOrder })
                .skip(skip)
                .limit(parseInt(limit)),
            Issue.countDocuments(filter),
        ]);

        res.json({
            success: true,
            message: "Issues retrieved successfully",
            data: {
                issues: issues.map(mapIssueSummaryResponse),
                pagination: {
                    total,
                    page: parseInt(page),
                    pages: Math.ceil(total / parseInt(limit)),
                },
            },
        });
    } catch (err) {
        next(err);
    }
};

const getPublicFeed = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, category, lat, lng, radius = 10 } = req.query;
        const filter = {};
        if (category) filter.category = category;

        if (lat && lng) {
            filter.location = {
                $near: {
                    $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
                    $maxDistance: parseFloat(radius) * 1000,
                },
            };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const issues = await Issue.find(filter)
            .populate("reportedBy", "name profilePhoto")
            .sort({ upvoteCount: -1, createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        res.json({
            success: true,
            message: "Public feed retrieved successfully",
            data: {
                issues: issues.map(mapIssueSummaryResponse),
                page: parseInt(page),
            },
        });
    } catch (err) {
        next(err);
    }
};

const getIssueById = async (req, res, next) => {
    try {
        const issue = await Issue.findById(req.params.id)
            .populate("reportedBy", "name email profilePhoto")
            .populate("assignedTo", "name email departmentName phone")
            .populate("repairProof.uploadedBy", "name");

        if (!issue) {
            return res.status(404).json({ success: false, message: "Issue not found" });
        }

        res.json({
            success: true,
            message: "Issue retrieved successfully",
            data: mapIssueDetailResponse(issue),
        });
    } catch (err) {
        next(err);
    }
};

const updateIssueStatus = async (req, res, next) => {
    try {
        const validatedData = validateIssueUpdateStatus(req.body);

        const issue = await Issue.findById(req.params.id);
        if (!issue) return res.status(404).json({ success: false, message: "Issue not found" });

        const allowedTransitions = {
            submitted: ["verified", "closed"],
            verified: ["assigned"],
            assigned: ["in_progress"],
            in_progress: ["pending_review"],
            pending_review: ["resolved", "reopened"],
            resolved: ["closed", "reopened"],
            reopened: ["assigned", "in_progress"],
            closed: [],
        };

        if (!allowedTransitions[issue.status]?.includes(validatedData.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot transition from '${issue.status}' to '${validatedData.status}'`,
            });
        }

        issue.status = validatedData.status;
        if (validatedData.resolutionNote) issue.resolutionNote = validatedData.resolutionNote;
        if (validatedData.status === "resolved") issue.resolvedAt = new Date();

        if (req.files && req.files.length > 0) {
            const proofs = req.files.map((f) => ({
                url: `/uploads/${f.filename}`,
                uploadedBy: req.user._id,
            }));
            issue.repairProof.push(...proofs);
        }

        await issue.save();
        await issue.populate("reportedBy", "name email");
        await issue.populate("assignedTo", "name email");

        if (issue.reportedBy) {
            await createNotification({
                recipient: issue.reportedBy,
                issue: issue._id,
                type: "status_changed",
                title: "Issue Status Updated",
                message: `Your issue "${issue.title}" is now ${validatedData.status.replace("_", " ")}.`,
            });
        }

        res.json({
            success: true,
            message: "Issue status updated successfully",
            data: mapIssueDetailResponse(issue),
        });
    } catch (err) {
        next(err);
    }
};


const getAllUsers = async (req, res, next) => {
    try {
        const { role, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (role) filter.role = role;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [users, total] = await Promise.all([
            User.find(filter).select("-password").skip(skip).limit(parseInt(limit)),
            User.countDocuments(filter),
        ]);

        res.json({
            success: true,
            message: "Users retrieved successfully",
            data: {
                users: users.map(mapUserAdminResponse),
                pagination: {
                    total,
                    page: parseInt(page),
                    pages: Math.ceil(total / parseInt(limit)),
                },
            },
        });
    } catch (err) {
        next(err);
    }
};



module.exports = {
    register, login, getMe, updateProfile, changePassword,
    createIssue, getIssues, getPublicFeed, getIssueById,
    updateIssueStatus,
    getAllUsers,
};