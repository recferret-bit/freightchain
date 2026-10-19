/* Entity core – pure ES modules shared by the game (client/js/world/entities.js), the server (validation on every write) and the MCP server.
   No three.js here: plan.js drives a sink, measure.js measures a part list. */
export { compileExpr, parseExpr, ExprError, LIMITS as EXPR_LIMITS } from './expr.js';
export { parseSource, printSource, SourceError, MAX_SOURCE } from './source.js';
export { compileEntity, toParts, PlanError, GEOS, ROLES, SIGN_STYLES, RUN_LIMITS } from './plan.js';
export { measure, boxes } from './measure.js';
export { validateEntity, KINDS, ID } from './schema.js';
export { ROSTER, rosterOf, landmarkFootprint, LANDMARK_SLOTS, LANDMARK_PARAMS, VEHICLE_PARAMS } from './roster.js';
