/**
 * Request-body schemas for the restore endpoints (task 10.19a). The payloads
 * are what the delete calls returned, so they are strict about shape — but they
 * are still untrusted input: ownership never comes from them, only from the
 * current user.
 */
const nullableString = { type: ['string', 'null'] } as const

export const itemPayloadSchema = {
  type: 'object',
  required: [
    'id',
    'title',
    'orderIndex',
    'timeToConsumeMinutes',
    'timeToConsumeIsEstimated',
    'source',
    'createdAt',
    'updatedAt',
  ],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 100 },
    title: { type: 'string', minLength: 1, maxLength: 500 },
    orderIndex: { type: 'integer' },
    timeToConsumeMinutes: { type: 'integer', minimum: 0 },
    timeToConsumeIsEstimated: { type: 'boolean' },
    externalRef: { type: ['string', 'null'], maxLength: 500 },
    source: { type: 'string', enum: ['manual', 'import'] },
    year: { type: ['integer', 'null'] },
    group: { type: ['string', 'null'], maxLength: 500 },
    tags: { type: ['array', 'null'], items: { type: 'string', maxLength: 40 }, maxItems: 20 },
    consumedAt: nullableString,
    notes: { type: ['string', 'null'], maxLength: 2048 },
    isNew: { type: 'boolean' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const

export const groupPayloadSchema = {
  type: 'object',
  required: ['id', 'name', 'orderIndex', 'createdAt', 'updatedAt'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 100 },
    name: { type: 'string', minLength: 1, maxLength: 500 },
    orderIndex: { type: 'integer', minimum: 0 },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const

export const dismissalPayloadSchema = {
  type: 'object',
  required: ['id', 'titleKey', 'createdAt'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 100 },
    externalRef: { type: ['string', 'null'], maxLength: 500 },
    titleKey: { type: 'string', maxLength: 500 },
    createdAt: { type: 'string' },
  },
} as const

export const snapshotPayloadSchema = {
  type: 'object',
  required: ['id', 'title', 'orderIndex', 'timeToConsumeMinutes', 'timeToConsumeIsEstimated'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 100 },
    title: { type: 'string', maxLength: 500 },
    orderIndex: { type: 'integer' },
    timeToConsumeMinutes: { type: 'integer', minimum: 0 },
    timeToConsumeIsEstimated: { type: 'boolean' },
    externalRef: { type: ['string', 'null'], maxLength: 500 },
    year: { type: ['integer', 'null'] },
    group: { type: ['string', 'null'], maxLength: 500 },
    tags: { type: ['array', 'null'], items: { type: 'string', maxLength: 40 } },
    notes: { type: ['string', 'null'], maxLength: 2048 },
  },
} as const

export const listPayloadSchema = {
  type: 'object',
  required: ['id', 'title', 'mediaType', 'source', 'createdAt', 'updatedAt'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 100 },
    title: { type: 'string', minLength: 1, maxLength: 500 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    mediaType: { type: 'string', minLength: 1, maxLength: 100 },
    source: { type: 'string', enum: ['api', 'llm', 'manual', 'file', 'canonical'] },
    externalRef: { type: ['string', 'null'], maxLength: 500 },
    status: { type: ['string', 'null'], enum: ['complete', 'ongoing', null] },
    sourceYaml: nullableString,
    arrivedTitle: nullableString,
    arrivedDescription: nullableString,
    arrivedStatus: { type: ['string', 'null'], enum: ['complete', 'ongoing', null] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const
