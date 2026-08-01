import type { ConferenceDatabase } from '@conference/database';
import { publicUserIds } from '@conference/database';
import { and, eq, isNull } from 'drizzle-orm';

export type PublicUserSubjectType = 'staff' | 'customer';

export async function findPublicUserId(
  database: ConferenceDatabase,
  subjectType: PublicUserSubjectType,
  subjectUuid: string,
) {
  const [row] = await database
    .select({ publicId: publicUserIds.publicId })
    .from(publicUserIds)
    .where(
      and(
        eq(publicUserIds.subjectType, subjectType),
        eq(publicUserIds.subjectUuid, subjectUuid),
        isNull(publicUserIds.retiredAt),
      ),
    )
    .limit(1);
  return row?.publicId ?? null;
}

export async function requirePublicUserId(
  database: ConferenceDatabase,
  subjectType: PublicUserSubjectType,
  subjectUuid: string,
) {
  const publicId = await findPublicUserId(database, subjectType, subjectUuid);
  if (publicId === null) {
    throw new Error(`Missing public user ID for ${subjectType}:${subjectUuid}`);
  }
  return publicId;
}
