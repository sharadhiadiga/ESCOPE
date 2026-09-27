import { Request, Response } from 'express';
import { ElasticsearchService } from '../services/elasticsearch.service';
import { AuthenticatedUser } from '../middleware/auth';

export class EmailSearchController {
  static async searchEmails(req: Request, res: Response) {
    try {
      const user = req.user as AuthenticatedUser;
      if (!user || !user.id) {
        return res.status(401).json({
          success: false,
          error: { message: 'Unauthorized: Authentication required' },
        });
      }

      const query = typeof req.query.q === 'string' ? req.query.q : undefined;
      const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
      const limit = isNaN(limitParam) ? 50 : Math.min(100, Math.max(1, limitParam));

      const searchResult = await ElasticsearchService.searchEmails(user.id, query, limit);

      return res.status(200).json({
        success: true,
        total: searchResult.total,
        data: searchResult.results,
      });
    } catch (err: any) {
      console.error('[EmailSearchController] Search error:', err);
      return res.status(500).json({
        success: false,
        error: {
          message: err.message || 'Failed to search emails',
        },
      });
    }
  }
}
