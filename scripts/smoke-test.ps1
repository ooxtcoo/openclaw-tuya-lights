param(
    [string]$Lamp = "stehlampe"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "Building lampctl..."
go build -o lampctl.exe .

Write-Host "Checking status..."
.\lampctl.exe $Lamp status

Write-Host "Turning off..."
.\lampctl.exe $Lamp off
Start-Sleep -Milliseconds 800

Write-Host "Turning on..."
.\lampctl.exe $Lamp on
Start-Sleep -Milliseconds 800

Write-Host "Brightness 40..."
.\lampctl.exe $Lamp brightness --value 40
Start-Sleep -Milliseconds 800

Write-Host "Warm white..."
.\lampctl.exe $Lamp warmwhite
Start-Sleep -Milliseconds 800

Write-Host "Cold white..."
.\lampctl.exe $Lamp coldwhite
Start-Sleep -Milliseconds 800

Write-Host "Final status..."
.\lampctl.exe $Lamp status

Write-Host "Smoke test completed."
