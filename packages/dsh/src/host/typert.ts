import { TYPERT_REMOTE } from "../client/remote-contribution.js"

/** Loader-discovered Host invocation metadata for the OmAgents Remote service. */
export const TYPERT = {
  package: "@omagents/omagents-dsh",
  face: "host",
  schemas: [],
  get invocations() {
    return TYPERT_REMOTE.descriptors
  },
  model: {
    services: [],
    events: [],
    objects: [],
  },
} as const
