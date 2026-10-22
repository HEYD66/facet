param([string]$ProcessIds)
$ErrorActionPreference = 'Stop'
if ($ProcessIds -notmatch '^\d+(,\d+)*$') { throw 'Invalid process IDs' }
foreach ($processNumber in ($ProcessIds -split ',')) {
    try {
        $targetProcess = Get-Process -Id ([int]$processNumber) -ErrorAction Stop
        $privateKB = [long]([math]::Floor($targetProcess.PrivateMemorySize64 / 1024))
        $cpuSeconds = '-'
        $created = '-'
        try {
            $processorTime = $targetProcess.TotalProcessorTime
            if ($null -ne $processorTime) {
                $cpuSeconds = $processorTime.TotalSeconds.ToString('R', [Globalization.CultureInfo]::InvariantCulture)
                $created = $targetProcess.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
            }
        } catch {
            # Preserve the memory sample if process timing is inaccessible.
        }
        $sampleSeconds = ([Diagnostics.Stopwatch]::GetTimestamp() / [double][Diagnostics.Stopwatch]::Frequency).ToString('R', [Globalization.CultureInfo]::InvariantCulture)
        '{0} {1} {2} {3} {4}' -f $targetProcess.Id, $privateKB, $cpuSeconds, $created, $sampleSeconds
    } catch {
        # Exited/inaccessible processes are omitted; caller reports incomplete samples.
    }
}
