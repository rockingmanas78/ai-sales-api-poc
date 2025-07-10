// routes/userRoutes.js
import { Router } from 'express';
import {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
} from '../controllers/user.controller.js';
import verifyToken from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';

const userRouter = Router();

userRouter.post('/', createUser);
userRouter.get('/',verifyToken(),authorize('view_users'), getUsers); // tenantId from query
userRouter.get('/:userId',verifyToken(),authorize('view_users'), getUserById); // tenantId from body
userRouter.put('/:userId', verifyToken(),authorize('manage_users'),updateUser); // tenantId from body
userRouter.delete('/:userId', verifyToken(),authorize('manage_users'),deleteUser); // tenantId from body

export default userRouter;
