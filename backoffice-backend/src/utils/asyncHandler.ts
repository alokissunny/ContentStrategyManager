import type { NextFunction, Request, RequestHandler, Response } from 'express'

/** Forwards rejected promises to the error middleware instead of hanging. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next)
  }
}
