import { Request, Response, NextFunction } from 'express';
import { EnvConfig, AuthenticationError } from '../types';

export function createAuthMiddleware(config: EnvConfig) {
  const expectedToken = config.MCP_BEARER_TOKEN;

  if (!expectedToken) {
    console.warn('⚠️  ATTENZIONE: MCP_BEARER_TOKEN non configurato! L\'autenticazione è disabilitata.');
  }

  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Skip auth per health check
    if (req.path === '/health' || req.path === '/') {
      return next();
    }

    // Se token non configurato, permetti (solo per development)
    if (!expectedToken && config.NODE_ENV === 'development') {
      console.warn('⚠️  Autenticazione saltata (development mode senza token)');
      return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new AuthenticationError('Header Authorization mancante');
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationError('Formato Authorization non valido. Usa: Bearer <token>');
    }

    if (token !== expectedToken) {
      throw new AuthenticationError('Token non valido');
    }

    next();
  };
}

export function createErrorHandler(config: EnvConfig) {
  return function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
    console.error('Error:', err.message, err.stack);

    if (err instanceof AuthenticationError) {
      res.status(401).json({
        error: 'Non autorizzato',
        message: err.message,
        code: err.code,
      });
      return;
    }

    // Errori validazione Zod
    if (err.name === 'ZodError') {
      res.status(400).json({
        error: 'Parametri non validi',
        message: err.message,
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    // Errori MCP personalizzati
    if (err.name === 'MCPError' || err.name === 'DatabaseError' || 
        err.name === 'ValidationError' || err.name === 'NotFoundError') {
      const statusCode = (err as any).statusCode || 500;
      res.status(statusCode).json({
        error: err.name,
        message: err.message,
        code: (err as any).code || 'INTERNAL_ERROR',
        details: (err as any).details,
      });
      return;
    }

    // Errore generico
    res.status(500).json({
      error: 'Errore interno del server',
      message: config.NODE_ENV === 'development' ? err.message : 'Si è verificato un errore imprevisto',
      code: 'INTERNAL_ERROR',
    });
  };
}