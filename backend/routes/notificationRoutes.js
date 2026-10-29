
const express = require("express");
const {
  authenticateToken,
  authorizeRoles
} = require("../middleware/authMiddleware");

const router = express.Router();

// Only authenticated students can access student notifications.
router.use(
  authenticateToken,
  authorizeRoles("JOB_SEEKER")
);

// GET /api/v1/notifications
// Retrieve the current student's notifications.
router.get("/", async (req, res, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const userId = req.auth.userId;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      prisma.notification.count({
        where: {
          userId,
          isRead: false
        }
      })
    ]);

    return res.json({
      success: true,
      message: "Notifications retrieved successfully.",
      notifications,
      unreadCount
    });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/v1/notifications/read-all
// Mark all of the current student's notifications as read.
router.patch("/read-all", async (req, res, next) => {
  try {
    const prisma = req.app.locals.prisma;

    const result = await prisma.notification.updateMany({
      where: {
        userId: req.auth.userId,
        isRead: false
      },
      data: {
        isRead: true
      }
    });

    return res.json({
      success: true,
      message: "Notifications marked as read.",
      updatedCount: result.count
    });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/v1/notifications/:id/read
// Mark one notification as read, only if it belongs to the student.
router.patch("/:id/read", async (req, res, next) => {
  try {
    const prisma = req.app.locals.prisma;

    const result = await prisma.notification.updateMany({
      where: {
        id: req.params.id,
        userId: req.auth.userId,
        isRead: false
      },
      data: {
        isRead: true
      }
    });

    if (result.count === 0) {
      const notification = await prisma.notification.findFirst({
        where: {
          id: req.params.id,
          userId: req.auth.userId
        }
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: "Notification not found."
        });
      }

      return res.json({
        success: true,
        message: "Notification was already marked as read.",
        notification
      });
    }

    const notification = await prisma.notification.findFirst({
      where: {
        id: req.params.id,
        userId: req.auth.userId
      }
    });

    return res.json({
      success: true,
      message: "Notification marked as read.",
      notification
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
