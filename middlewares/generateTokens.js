import jwt from 'jsonwebtoken';

// Generate Access Token (valid for 1 hour)
export const generateAuthToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      role: user.role,
      tenantId: user.tenantId // Include tenantId in the token
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

// Generate Refresh Token (valid for 7 days)
export const generateRefreshToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      role: user.role,
      tenantId: user.tenantId // Include tenantId in the token
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};

// Generate both tokens
export const generateTokens = (user) => {
  return {
    accessToken: generateAuthToken(user),
    refreshToken: generateRefreshToken(user)
  };
};
/*
// Domain routes - Admin only
router.post('/', 
  // verifyToken(), 
  // authorize('manage_domains'), 
  domainController.createDomain
);

// Email routes - Both Admin and Manager can access
router.post('/', 
  // verifyToken(), 
  // authorize('manage_emails'), 
  emailController.createEmail
);

// Public pricing routes - only need verification, not authorization
router.get('/', 
  verifyToken({ required: false }), // Token optional
  pricingController.listPricing
);
*/