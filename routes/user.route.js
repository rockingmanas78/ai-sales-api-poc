// routes/userRoutes.js
import { Router } from 'express';
import {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
} from '../controllers/user.controller.js';

const userRouter = Router();

userRouter.post('/', createUser);
userRouter.get('/', getUsers); // tenantId from query
userRouter.get('/:userId', getUserById); // tenantId from body
userRouter.put('/:userId', updateUser); // tenantId from body
userRouter.delete('/:userId', deleteUser); // tenantId from body

export default userRouter;
