import type { Response } from "express";
import type { z } from "zod";

export function sendValidationError(
  res: Response,
  issues: readonly z.ZodIssue[],
): void {
  res.status(400).json({
    error: "请求参数不合法",
    details: issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}
