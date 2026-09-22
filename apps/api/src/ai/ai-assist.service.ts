import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Bounds token usage/cost — also a reasonable ceiling for what an admin
// actually needs to review in one sitting. If a tenant genuinely has more
// than this many PENDING bookings at once, that's a UX problem for a
// paginated dashboard view, not something this endpoint should try to
// summarize in full.
const MAX_GROUNDING_BOOKINGS = 50;

const SYSTEM_PROMPT =
  "You are a read-only assistant embedded in a booking admin dashboard. " +
  "Answer ONLY using the JSON data provided in the next message — it is the complete and only source of truth available to you. " +
  "If the answer is not fully contained in that JSON, say explicitly that you do not have that information — never guess, estimate, or invent a booking, time, or name that is not present in the data. " +
  "You have no ability to create, confirm, or cancel bookings, and no access to any data beyond what is given below — never imply that you performed, or can perform, any action, and never reference information outside the provided JSON. " +
  "Answer in the same language as the question.";

export interface AiAssistResult {
  answer: string;
  groundedOnPendingBookings: number;
}

/**
 * Grounding data is this tenant's PENDING bookings ONLY — fetched via
 * `this.prisma.client` (never `this.prisma` directly), so RLS scopes the
 * query to the caller's own tenant exactly like every other tenant-scoped
 * query in this codebase. See AGENTS.md rule #1.
 *
 * This service NEVER writes. It has no method that calls .create/.update/
 * .delete on anything — confirming or cancelling a booking still requires
 * going through the existing PATCH /bookings/:id/confirm|cancel routes,
 * with their own RBAC and business-rule checks. An LLM response is
 * advisory text, never a side effect.
 */
@Injectable()
export class AiAssistService {
  private readonly logger = new Logger(AiAssistService.name);

  constructor(private readonly prisma: PrismaService) {}

  async assist(question: string): Promise<AiAssistResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Explicit, documented behavior (docs/ai-assist.md) — not a 500.
      // This is also exactly what CI sees: no OPENAI_API_KEY secret is
      // configured there on purpose, so the e2e suite exercises this
      // exact branch rather than needing a real key/network call.
      throw new ServiceUnavailableException(
        'AI assist is not configured on this environment (missing OPENAI_API_KEY).',
      );
    }

    const pendingBookings = await this.prisma.client.booking.findMany({
      where: { status: BookingStatus.PENDING },
      include: {
        branch: { select: { name: true } },
        service: { select: { name: true } },
        staff: { include: { user: { select: { email: true } } } },
        client: { select: { email: true } },
      },
      orderBy: { startTime: 'asc' },
      take: MAX_GROUNDING_BOOKINGS,
    });

    const groundingData = pendingBookings.map((b) => ({
      id: b.id,
      branch: b.branch.name,
      service: b.service.name,
      staff: b.staff.user.email,
      client: b.client.email,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: b.status,
    }));

    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    let answer: string | undefined;
    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0, // deterministic — this is an admin data tool, not a creative one
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `DATA (this tenant's PENDING bookings, ${groundingData.length} of them):\n` +
              `${JSON.stringify(groundingData)}\n\n` +
              `QUESTION: ${question}`,
          },
        ],
      });
      answer = completion.choices[0]?.message?.content?.trim();
    } catch (err) {
      this.logger.warn(`OpenAI call failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new ServiceUnavailableException('AI assist is temporarily unavailable.');
    }

    if (!answer) {
      throw new ServiceUnavailableException('AI assist returned an empty response.');
    }

    return { answer, groundedOnPendingBookings: groundingData.length };
  }
}
