// Recorded on a Mac (2026-11-14) for lib.test.js.

export const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     4132.
Pages active:                                 240599.
Pages inactive:                               239325.
Pages speculative:                               397.
Pages throttled:                                   0.
Pages wired down:                             155379.
Pages purgeable:                                1001.
Pages stored in compressor:                   633828.
Pages occupied by compressor:                 358253.
`;

// sysctl -n hw.memsize hw.ncpu kern.memorystatus_vm_pressure_level
export const SYSCTL = `17179869184
10
1
`;

export const SWAP = "total = 5120.00M  used = 3709.31M  free = 1410.69M  (encrypted)\n";

export const DF = `Filesystem   1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on
/dev/disk3s5   482797652 437451252  14447236    97% 7514332 144472360    5%   /System/Volumes/Data
`;

export const BATT_ON = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=29884515)	72%; discharging; 8:21 remaining present: true
`;
export const BATT_AC = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=29884515)	100%; charged; 0:00 remaining present: true
`;

// ps -axo pid=,ppid=,rss=,time=,comm=
export const PS = `    1     0  19040  78:09.72 /sbin/launchd
  440     1  21696  43:37.42 /usr/libexec/logd
 9940  9939 185280   8:21.42 /Users/shoaib/Library/Application Support/Claude/claude-code/2.1.325/485fdac4332e/claude.app/Contents/MacOS/claude
`;
