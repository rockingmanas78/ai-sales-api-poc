import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Permission map defining what each role can do
 */
const permissions = {
  SUPERADMIN: ['*'], // Wildcard - all permissions
  
  ADMIN: [
    // Tenant management
    'view_tenant',
    'manage_tenant',

    // User management
    'manage_users',
    'view_users',
    
    // Domain management (admin only)
    'manage_domains',
    'view_domains',
    
    // Email management
    'manage_emails',
    'view_emails',
    
    // Lead management
    'manage_leads',
    'view_leads',
    
    // Campaign management
    'manage_campaigns',
    'view_campaigns',
    
    // Template management
    'manage_templates',
    'view_templates',
    
    // Reports
    'view_reports',

    //Company & Product QA
    'manage_qas',
    'view_qas',

    //products
    'view_products',
    'manage_products'
  ],
  
  MANAGER: [
    // View tenant profile (but not update)
    'view_tenant',
    // Email management (managers can handle)
    'manage_emails',
    'view_emails',
    
    // Lead management
    'view_leads',
    'manage_own_leads',
    
    // Campaign management (limited)
    'view_campaigns',
    'manage_own_campaigns',
    
    // Template management (limited)
    'view_templates',
    'manage_own_templates',
    
    // Reports (limited)
    'view_own_reports',
    
    //Company & Product QA 
    'view_qas',

    //products
    'view_products'
  ]
};

/**
 * RBAC middleware factory
 * @param {string} requiredPermission - The permission required for this route
 * @param {Object} options - Additional options for permission checking
 * @returns {Function} Express middleware
 */
export const authorize = (requiredPermission, options = {}) => {
  return async (req, res, next) => {
    try {
      // Get user from request (attached by verifyToken middleware)
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({ message: 'Unauthorized - Authentication required' });
      }
      
      const { role, id: userId, tenantId } = user;
      
      // Check if user has wildcard permission or specific permission
      const userPermissions = permissions[role] || [];
      const hasPermission = userPermissions.includes('*') || userPermissions.includes(requiredPermission);
      
      if (!hasPermission) {
        return res.status(403).json({ message: 'Forbidden - Insufficient permissions' });
      }
      
      // For "own" resources, verify ownership using request parameters
      if (requiredPermission.includes('own_')) {
        // Check if the resource belongs to the user or tenant
        const resourceTenantId = req.query.tenantId || req.body.tenantId;
        const resourceUserId = req.query.userId || req.body.userId;
        
        // If tenantId is provided in the request, verify it matches the user's tenantId
        if (resourceTenantId && resourceTenantId !== tenantId) {
          return res.status(403).json({ message: 'Forbidden - Resource belongs to a different tenant' });
        }
        
        // If userId is provided in the request, verify it matches the user's id
        if (resourceUserId && resourceUserId !== userId) {
          return res.status(403).json({ message: 'Forbidden - Resource belongs to a different user' });
        }
      }
      
      // If we get here, user is authorized
      next();
    } catch (error) {
      console.error('RBAC authorization error:', error);
      return res.status(500).json({ message: 'Internal server error during authorization' });
    }
  };
};

export { permissions };
export default authorize;