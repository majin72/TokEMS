import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import { API_ERROR_CODES, EventIdParamSchema, type EventId } from '@conference/contracts';
import { DomainError } from './domain-error.js';

function parseEventId(value: unknown): EventId {
  const result = EventIdParamSchema.safeParse(value);
  if (!result.success) {
    throw new DomainError(
      API_ERROR_CODES.VALIDATION_ERROR,
      '大会 ID 必须是 101–2147483647 的整数',
      HttpStatus.BAD_REQUEST,
      { issues: result.error.issues },
    );
  }
  return result.data;
}

@Injectable()
export class EventIdPipe implements PipeTransform<unknown, EventId> {
  transform(value: unknown): EventId {
    return parseEventId(value);
  }
}

@Injectable()
export class OptionalEventIdPipe implements PipeTransform<unknown, EventId | undefined> {
  transform(value: unknown): EventId | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return parseEventId(value);
  }
}
