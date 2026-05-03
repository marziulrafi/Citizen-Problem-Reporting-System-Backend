function mapUserAuthResponse(user) {
    return {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
    };
}

function mapUserMinimalResponse(user) {
    if (!user) return null;
    return {
        _id: user._id,
        name: user.name,
    };
}

function mapIssueDetailResponse(issue) {
    const issueObj = issue.toObject ? issue.toObject() : issue;
    return {
        _id: issueObj._id,
        issueId: issueObj.issueId,
        title: issueObj.title,
        description: issueObj.description,
        category: issueObj.category,
        priority: issueObj.priority,
        status: issueObj.status,
        location: issueObj.location,
        address: issueObj.address,
        reportedBy: mapUserMinimalResponse(issueObj.reportedBy),
        isAnonymous: issueObj.isAnonymous || false,
        media: issueObj.media || [],
        severity: issueObj.severity || 3,
        affectedPeople: issueObj.affectedPeople || 0,
        expectedResolutionAt: issueObj.expectedResolutionAt,
        resolvedAt: issueObj.resolvedAt || null,
        createdAt: issueObj.createdAt,
        updatedAt: issueObj.updatedAt,
    };
}

module.exports = {
    mapUserAuthResponse,
    mapIssueDetailResponse,
    mapUserMinimalResponse,
};
