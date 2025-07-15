import { Router } from 'express';
import {
  signup,
  login,
  googleLogin,
  refreshToken,
  requestReset,
  resetPassword,
  abc,
} from '../controllers/auth.controller.js'

const router = Router();

router.get('/get-ip', (req, res) => {
  const clientIp =
    req.headers['x-forwarded-for'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress;
  res.send({ ip: clientIp });
});

router.post('/signup', signup);

// Remove
router.post('/abc', abc);


router.post('/login', login);


router.post('/google', googleLogin);

// Refresh token
router.post('/refresh', refreshToken);


router.post('/request-reset', requestReset);


router.post('/reset', resetPassword);

router.get('/', (req, res) => {
  res.status(200).json({ message: 'Test route is working!' });
});

export default router;

