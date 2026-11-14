// Recorded on a Mac (2026-11-14) for lib.test.js: real `lsof` and `ps` output, plus one synthetic IPv6 listener.

// lsof -nP -iTCP -sTCP:LISTEN -Fpcn
export const LSOF = `p745
crapportd
f11
n*:49261
f12
n*:49261
p796
cControlCenter
f9
n*:7000
f10
n*:7000
f11
n*:5000
f12
n*:5000
p1093
cmoshi-hook
f7
n127.0.0.1:24543
p8035
cPython
f3
n127.0.0.1:18791
f4
n127.0.0.1:18792
p12925
c2.1.325
f20
n127.0.0.1:51304
p4242
cnode
f21
n[::1]:3000
`;

// lsof -a -p 745,8035 -d cwd -Fpn
export const CWDS = `p745
fcwd
n/
p8035
fcwd
n/private/tmp/claude-501/-Users-shoaib-code-experiments-margo--claude-worktrees-ai-artifacts-research-6b95a0/73526e16-e334-4ecf-bf73-fc9affff322f/scratchpad/spike
`;

// ps -axo pid=,ppid=,etime=,comm=
export const PS = `  745     1 05-14:20:36 /usr/libexec/rapportd
 8035     1    02:03:04 /opt/homebrew/Cellar/python@3.15/3.15.2/Frameworks/Python.framework/Versions/3.15/Resources/Python.app/Contents/MacOS/Python
 9939 17303    12:29:59 /Applications/Claude.app/Contents/Helpers/disclaimer
 9940  9939    12:29:59 /Users/shoaib/Library/Application Support/Claude/claude-code/2.1.325/485fdac4332e/claude.app/Contents/MacOS/claude
17303     1    14:49:16 /Applications/Claude.app/Contents/MacOS/Claude
`;

export const SCRATCH = "/private/tmp/claude-501/-Users-shoaib-code-experiments-margo--claude-worktrees-ai-artifacts-research-6b95a0/73526e16-e334-4ecf-bf73-fc9affff322f/scratchpad/spike";
