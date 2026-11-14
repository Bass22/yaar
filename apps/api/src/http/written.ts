import { HttpStatus } from '@nestjs/common';

/** A money writing or a request sent with its own id (rule 2): 201 when written, 200 when the same was already there. */
export const writtenStatus = (outcome: 'Recorded' | 'Duplicate'): HttpStatus => (outcome === 'Duplicate' ? HttpStatus.OK : HttpStatus.CREATED);
