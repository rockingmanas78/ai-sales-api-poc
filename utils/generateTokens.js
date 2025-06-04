import jwt from 'jsonwebtoken';

// Generate Access Token (valid for 1 hour)
export const generateAuthToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

// Generate Refresh Token (valid for 7 days)
export const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role },
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
