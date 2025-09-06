import { Router } from "express";
import {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
} from "../controllers/user.controller.js";
import { verifyToken } from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";
import { checkSeatAvailability } from "../middlewares/usage.js"; // 1. Import the new middleware

const userRouter = Router();

// 2. Add middleware to the user creation route
userRouter.post("/", verifyToken(), authorize("manage_users"), checkSeatAvailability, createUser);
userRouter.get("/", verifyToken(), authorize("view_users"), getUsers);
userRouter.get("/:userId", verifyToken(), authorize("view_users"), getUserById);
userRouter.put("/:userId", verifyToken(), authorize("manage_users"), updateUser);
userRouter.delete("/:userId", verifyToken(), authorize("manage_users"), deleteUser);

export default userRouter;
