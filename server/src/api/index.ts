import { Router } from "express";
import { onboardingRouter } from "./onboarding.js";
import { authRouter } from "./auth.js";
import { feedsRouter } from "./feeds.js";
import { itemsRouter } from "./items.js";
import { tokensRouter } from "./tokens.js";

export const apiRouter = Router();

apiRouter.use("/onboarding", onboardingRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/feeds", feedsRouter);
apiRouter.use("/items", itemsRouter);
apiRouter.use("/tokens", tokensRouter);
