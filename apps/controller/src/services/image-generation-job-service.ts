import { randomUUID } from "node:crypto";
import type {
  GenerateImageRequest,
  GenerateImageResponse,
  ImageGenerationJob,
} from "@nexu/shared";
import { logger } from "../lib/logger.js";
import {
  ImageGenerationFailedError,
  InvalidMediaReferenceError,
} from "./media-generation-service.js";

const DEFAULT_MAX_ACTIVE_JOBS = 8;
const DEFAULT_TERMINAL_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RETAINED_JOBS = 100;

type JobRecord = ImageGenerationJob;

type QueuedJob = {
  jobId: string;
  input: GenerateImageRequest;
};

export class ImageGenerationQueueFullError extends Error {
  constructor() {
    super("图片生成任务较多，请稍后再试");
    this.name = "ImageGenerationQueueFullError";
  }
}

export class ImageGenerationJobService {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly queue: QueuedJob[] = [];
  private readonly generateImage: (
    input: GenerateImageRequest,
  ) => Promise<GenerateImageResponse>;
  private readonly genId: () => string;
  private readonly now: () => number;
  private readonly maxActiveJobs: number;
  private readonly terminalTtlMs: number;
  private readonly maxRetainedJobs: number;
  private activeJobCount = 0;
  private draining = false;

  constructor(options: {
    generateImage: (
      input: GenerateImageRequest,
    ) => Promise<GenerateImageResponse>;
    genId?: () => string;
    now?: () => number;
    maxActiveJobs?: number;
    terminalTtlMs?: number;
    maxRetainedJobs?: number;
  }) {
    this.generateImage = options.generateImage;
    this.genId = options.genId ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.maxActiveJobs = options.maxActiveJobs ?? DEFAULT_MAX_ACTIVE_JOBS;
    this.terminalTtlMs = options.terminalTtlMs ?? DEFAULT_TERMINAL_TTL_MS;
    this.maxRetainedJobs = options.maxRetainedJobs ?? DEFAULT_MAX_RETAINED_JOBS;
  }

  submit(input: GenerateImageRequest): ImageGenerationJob {
    this.pruneTerminalJobs();
    if (this.activeJobCount >= this.maxActiveJobs) {
      throw new ImageGenerationQueueFullError();
    }

    const jobId = this.genId();
    const job: JobRecord = {
      jobId,
      status: "queued",
      createdAt: this.toIso(this.now()),
    };
    this.jobs.set(jobId, job);
    this.queue.push({ jobId, input });
    this.activeJobCount += 1;
    this.scheduleDrain();
    return this.snapshot(job);
  }

  get(jobId: string): ImageGenerationJob | null {
    this.pruneTerminalJobs();
    const job = this.jobs.get(jobId);
    return job ? this.snapshot(job) : null;
  }

  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => {
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const queued = this.queue.shift();
        if (!queued) continue;
        await this.run(queued);
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) this.scheduleDrain();
    }
  }

  private async run(queued: QueuedJob): Promise<void> {
    const job = this.jobs.get(queued.jobId);
    if (!job) {
      this.activeJobCount = Math.max(0, this.activeJobCount - 1);
      return;
    }

    job.status = "running";
    job.startedAt = this.toIso(this.now());
    logger.info({ jobId: job.jobId }, "image generation job started");

    try {
      job.result = await this.generateImage(queued.input);
      job.status = "succeeded";
      logger.info({ jobId: job.jobId }, "image generation job succeeded");
    } catch (error) {
      job.status = "failed";
      job.error = this.publicErrorMessage(error);
      if (
        !(error instanceof ImageGenerationFailedError) &&
        !(error instanceof InvalidMediaReferenceError)
      ) {
        logger.error(
          { err: error, jobId: job.jobId },
          "image generation job failed unexpectedly",
        );
      } else {
        logger.warn(
          { jobId: job.jobId, error: job.error },
          "image generation job failed",
        );
      }
    } finally {
      job.completedAt = this.toIso(this.now());
      this.activeJobCount = Math.max(0, this.activeJobCount - 1);
      this.pruneTerminalJobs();
    }
  }

  private publicErrorMessage(error: unknown): string {
    if (
      error instanceof ImageGenerationFailedError ||
      error instanceof InvalidMediaReferenceError
    ) {
      return error.message.slice(0, 240);
    }
    return "生成失败，请稍后重试";
  }

  private pruneTerminalJobs(): void {
    const cutoff = this.now() - this.terminalTtlMs;
    for (const [jobId, job] of this.jobs) {
      if (
        job.completedAt !== undefined &&
        Date.parse(job.completedAt) <= cutoff
      ) {
        this.jobs.delete(jobId);
      }
    }

    if (this.jobs.size <= this.maxRetainedJobs) return;
    for (const [jobId, job] of this.jobs) {
      if (job.status === "succeeded" || job.status === "failed") {
        this.jobs.delete(jobId);
        if (this.jobs.size <= this.maxRetainedJobs) break;
      }
    }
  }

  private snapshot(job: JobRecord): ImageGenerationJob {
    return {
      ...job,
      ...(job.result
        ? {
            result: {
              ...job.result,
              items: job.result.items.map((item) => ({ ...item })),
            },
          }
        : {}),
    };
  }

  private toIso(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }
}
