import jwt from 'jsonwebtoken';

/**
 * Middleware to verify JWT token and attach user to request
 * @param {Object} options - Configuration options
 * @param {boolean} options.required - Whether token is required (default: true)
 * @returns {Function} Express middleware
 */
export const verifyToken = (options = { required: true }) => {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7); // Remove 'Bearer ' prefix
    }

    if (!token && options.required) {
      return res.status(401).json({ message: 'Authentication token is required' });
    }

    if (!token && !options.required) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Attach token payload to req.user
      req.user = {
        id: decoded.id,
        role: decoded.role,
        tenantId: decoded.tenantId,
      };

      next();
    } catch (error) {
      console.error("JWT Error:", error);

      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Invalid or expired token' });
      }

      return res.status(500).json({ message: 'Internal server error during authentication' });
    }
  };
};

export default verifyToken;
