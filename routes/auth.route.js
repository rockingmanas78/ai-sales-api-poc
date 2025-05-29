import { Router } from 'express';
import { register, login } from '../controllers/authController.js';
const authRouter = Router();

// Register Tenant Admin
authRouter.post('/register', register);

// Login User(All roles)
authRouter.post('/login', login);

export default authRouter;