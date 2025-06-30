import jwt from 'jsonwebtoken';

/**
 * Middleware to verify JWT token and attach user to request
 * @param {Object} options - Configuration options
 * @param {boolean} options.required - Whether token is required (default: true)
 * @returns {Function} Express middleware
 */
export const verifyToken = (options = { required: true }) => {
  return async (req, res, next) => {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      let token = null;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7); // Remove 'Bearer ' prefix
      }
      
      // If token is required but not provided, return error
      if (options.required && !token) {
        return res.status(401).json({ message: 'Authentication token is required' });
      }
      
      // If token is not provided but not required, continue without user
      if (!token && !options.required) {
        return next();
      }
      
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Attach user data from token to request object
      // This avoids the need for a database query
      req.user = {
        id: decoded.id,
        role: decoded.role,
        tenantId: decoded.tenantId // Make sure this is included in your token payload
      };
      
      // Continue to next middleware
      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Invalid or expired token' });
      }
      
      return res.status(500).json({ message: 'Internal server error during authentication' });
    }
  };
};

export default verifyToken;