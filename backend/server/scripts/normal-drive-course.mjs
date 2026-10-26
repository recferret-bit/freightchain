// Acceptance inputs only. These frozen trip IDs and normal durations must match the live server course.
export function normalFreeCourse(choice = 'MEDIUM') {
  const courses = {
    EASY: { name: 'EASY', level: 1, trip: 'free-1c', minSeconds: 180, k: .3 },
    MEDIUM: { name: 'MEDIUM', level: 2, trip: 'free-2c', minSeconds: 300, k: .4 },
    HARD: { name: 'HARD', level: 3, trip: 'free-3c', minSeconds: 1800, k: .4 },
  };
  if (!Object.hasOwn(courses, choice)) throw new Error('NORMAL_DRIVE_LEVEL must be EASY, MEDIUM or HARD');
  return courses[choice];
}

export function assertNormalFreeCourse(ride, course) {
  if (ride.tier !== 'free' || ride.level !== course.level || ride.trip !== course.trip || ride.minSeconds !== course.minSeconds || ride.timeScale !== 1 || Math.abs(ride.completeDist - 28 * course.k * ride.minSeconds) > 1e-6) {
    throw new Error(`expected normal ${course.name} course: ${JSON.stringify(ride)}`);
  }
}
