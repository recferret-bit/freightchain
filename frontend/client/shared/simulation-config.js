// Verification defaults; drift tests compare these with the browser tunables.
export const SIMULATION_CONFIG = {
  "MAX_SPEED": 28,
  "REVERSE_MAX": 6,
  "CRASH_CLOSING": 7,
  "TRAFFIC_DRIFT": 2.5,
  "TRAFFIC": true,
  "TRAFFIC_GAP": 5,
  "TRAFFIC_CLEAR": 0.5,
  "TRAFFIC_LOOK": 12,
  "HOLES": true,
  "HOLE_WARN": 110,
  "CAR_FREE_GAP": 6,
  "CRASH_FRICTION": 4,
  "CAR_STUN": 1.2,
  "CAR_BACK_GAP": 12,
  "CAR_REVERSE_MAX": 3,
  "CAR_BLOCK_T": 5,
  "TRAFFIC_RUB_GAP": 1.5,
  "CRASH_TRUCK_MASS": 6,
  "CRASH_BOUNCE": 0.15,
  "CRASH_OVERLAP": 0.4,
  "SCRATCH_DMG": 1.5,
  "TRAFFIC_MAX": 7,
  "CROSS_MAX": 3,
  "CROSS_GAP": 4,
  "START_TURN_R": 22,
  "START_ACCESS": 190,
  "SIGNAL_GREEN": [
    16,
    26
  ],
  "SIGNAL_CROSS": [
    9,
    14
  ],
  "SIGNAL_AMBER": 3,
  "SIGNAL_CLEAR": 2,
  "START_FADE": 150,
  "TRUCK": {
    "MASS": 2.5,
    "POWER": 2.4,
    "GEAR_EXP": 0.4,
    "DRAG": 0.0013,
    "ROLL_RES": 0.18,
    "BRAKE": 5.5
  },
  "TORQUE_PEAK": 2000,
  "TORQUE_LOW_W": 800,
  "TORQUE_HIGH_W": 1500,
  "TORQUE_MIN": 0.12,
  "PARK_BRAKE": 9,
  "OFFROAD_DRAG": 1.2
};
export const SIMULATION_TRIPS = {
  "classic": {
    "bends": 1,
    "traffic": 1,
    "cross": 1,
    "calm": false,
    "start": "depot"
  },
  "free": {
    "bends": 0.4,
    "traffic": 0.4,
    "cross": 0,
    "calm": true,
    "start": "straight"
  },
  "free-1": {
    "bends": 0.5,
    "traffic": 0.4,
    "cross": 0,
    "calm": true,
    "start": "straight",
    "road": {
      "first": [
        "dual"
      ],
      "weights": {
        "dual": 1
      }
    }
  },
  "free-2": {
    "bends": 0.8,
    "traffic": 0.7,
    "cross": 0.7,
    "calm": true,
    "start": "depot",
    "road": {
      "first": [
        "country",
        "fork"
      ],
      "weights": {
        "country": 3,
        "arterial": 1,
        "town": 1,
        "fork": 2
      },
      "holeChance": 1.5
    }
  },
  "free-3": {
    "bends": 1.3,
    "traffic": 1.4,
    "cross": 1.4,
    "calm": false,
    "start": "depot",
    "road": {
      "first": [
        "country",
        "fork"
      ],
      "weights": {
        "country": 3,
        "highway": 1,
        "arterial": 1.5,
        "town": 1.5,
        "fork": 1.5
      },
      "holeChance": 2
    }
  },
  "free-g": {
    "bends": 1.6,
    "traffic": 0.4,
    "cross": 0,
    "calm": true,
    "start": "straight",
    "road": {
      "first": [
        "xroad4"
      ],
      "weights": {
        "dual": 1
      },
      "firstLen": [
        500,
        500
      ]
    }
  },
  "free-1b": {
    "bends": 2,
    "traffic": 0.4,
    "cross": 0,
    "calm": true,
    "start": "straight",
    "road": {
      "first": [
        "xroad4"
      ],
      "weights": {
        "dual": 1
      },
      "firstLen": [
        500,
        500
      ]
    }
  },
  "free-2b": {
    "bends": 1.1,
    "traffic": 0.7,
    "cross": 0.7,
    "calm": true,
    "start": "depot",
    "road": {
      "first": [
        "open",
        "xroad",
        "fork",
        "xroad",
        "xroad",
        "xroad"
      ],
      "weights": {
        "open": 2,
        "highway": 1
      },
      "holeChance": 1.5,
      "firstLen": [
        450,
        450
      ]
    }
  },
  "free-1c": {
    "bends": 3,
    "traffic": 0.4,
    "cross": 0,
    "calm": true,
    "start": "straight",
    "road": {
      "first": [
        "xroad4",
        "xroad4"
      ],
      "weights": {
        "dual": 1
      },
      "firstLen": [
        500,
        500
      ]
    }
  },
  "free-2c": {
    "bends": 1.35,
    "traffic": 0.8,
    "cross": 0.8,
    "calm": true,
    "start": "depot",
    "road": {
      "first": [
        "open",
        "xroad",
        "fork",
        "xroad",
        "xroad"
      ],
      "weights": {
        "open": 2,
        "highway": 1
      },
      "holeChance": 1.5,
      "firstLen": [
        450,
        450
      ]
    }
  },
  "free-3b": {
    "bends": 1.6,
    "traffic": 1.4,
    "cross": 1.4,
    "calm": false,
    "start": "depot",
    "road": {
      "first": [
        "open",
        "xroad",
        "highway",
        "xroad",
        "fork",
        "xroad",
        "xroad",
        "fork",
        "xroad",
        "xroad"
      ],
      "weights": {
        "open": 2,
        "highway": 1
      },
      "holeChance": 2,
      "firstLen": [
        450,
        450
      ]
    }
  },
  "free-3c": {
    "bends": 1.6,
    "traffic": 1.4,
    "cross": 1.4,
    "calm": false,
    "start": "depot",
    "road": {
      "first": [
        "open",
        "xroad",
        "highway",
        "xroad",
        "fork",
        "xroad",
        "xroad",
        "fork",
        "xroad",
        "xroad"
      ],
      "weights": {
        "open": 2,
        "highway": 1
      },
      "holeChance": 2,
      "firstLen": [
        450,
        450
      ]
    }
  },
  "1h": {
    "bends": 1,
    "traffic": 1,
    "cross": 1,
    "calm": false,
    "start": "depot"
  },
  "4h": {
    "bends": 1.2,
    "traffic": 1.4,
    "cross": 1.4,
    "calm": false,
    "start": "depot"
  },
  "8h": {
    "bends": 1.4,
    "traffic": 1.8,
    "cross": 1.8,
    "calm": false,
    "start": "depot"
  }
};
