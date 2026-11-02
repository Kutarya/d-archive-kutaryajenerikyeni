param([string]$RequestFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  if ($request.op -eq 'voices') {
    $voices = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
      @{ id = 'sapi:' + $_.VoiceInfo.Name; name = $_.VoiceInfo.Name; locale = $_.VoiceInfo.Culture.Name; gender = $_.VoiceInfo.Gender.ToString(); offline = $true }
    })
    ConvertTo-Json -InputObject $voices -Compress
  } else {
    $speaker.SelectVoice($request.voice.Substring(5))
    $speaker.Rate = [Math]::Max(-5, [Math]::Min(5, [int][Math]::Round([double]$request.rate / 10)))
    $speaker.SetOutputToWaveFile($request.output)
    $speaker.Speak([string]$request.text)
    @{ ok = $true; output = $request.output } | ConvertTo-Json -Compress
  }
} finally { $speaker.Dispose() }
