# Quita el registro del sparse package de Isla.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\unregister-dev.ps1
$ErrorActionPreference = 'Stop'

$paquete = Get-AppxPackage -Name 'IsbarCompaneroDev'
if (-not $paquete) {
    Write-Host 'El paquete Isla no está registrado.'
    return
}
Remove-AppxPackage -Package $paquete.PackageFullName
Write-Host "Quitado: $($paquete.PackageFullName)"
