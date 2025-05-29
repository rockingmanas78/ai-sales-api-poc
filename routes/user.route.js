import { Router } from 'express';
import { createUser, getUsers } from '../controllers/userController.js';
const userRouter = Router();

userRouter.post('/', createUser);
userRouter.get('/', getUsers);

// Create a new user along with user
userRouter.post('/', createUser);

// Get users
userRouter.get('/', getUsers);

// Get single user
userRouter.get('/:userId', getUsers);

// Update user
userRouter.put('/:userId', getUsers);

// Delete user
userRouter.delete('/:userId', getUsers);

export default userRouter;