param([string]$ProcessIds)
$ErrorActionPreference = 'Stop'
if ($ProcessIds -notmatch '^\d+(,\d+)*$') { throw 'Invalid process IDs' }
foreach ($processNumber in ($ProcessIds -split ',')) {
    try {
        $targetProcess = Get-Process -Id ([int]$processNumber) -ErrorAction Stop
        '{0} {1}' -f $targetProcess.Id, ([long]([math]::Floor($targetProcess.PrivateMemorySize64 / 1024)))
    } catch {
        # Exited/inaccessible processes are omitted; caller reports incomplete samples.
    }
}
