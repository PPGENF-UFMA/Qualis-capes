param(
    [ValidateSet("start","stop","restart","status")]
    [string]$Action = "start"
)

$PID_FILE = Join-Path $PSScriptRoot ".server_pid"
$PORT = if ($env:PORT) { $env:PORT } else { 8080 }

function Get-PortOccupant {
    $conn = netstat -ano | Select-String ":$PORT\s.*LISTENING"
    if ($conn) {
        $firstConn = if ($conn -is [array]) { $conn[0] } else { $conn }
        $parts = $firstConn.ToString() -split '\s+'
        $svcPid = $parts[-1]
        $proc = Get-Process -Id $svcPid -ErrorAction SilentlyContinue
        if ($proc) {
            return [PSCustomObject]@{
                Pid  = $svcPid
                Name = $proc.ProcessName
            }
        }
    }
    return $null
}

function Find-ServerPid {
    $occupant = Get-PortOccupant
    if ($occupant -and ($occupant.Name -match "^python|^py")) {
        return $occupant.Pid
    }
    return $null
}

function Start-Server {
    $existingPid = Find-ServerPid
    if ($existingPid) {
        Write-Host "Servidor ja rodando (PID $existingPid) em http://127.0.0.1:$PORT"
        $existingPid | Out-File $PID_FILE -Encoding ascii
        return
    }

    # Verifica se a porta ja esta ocupada por outro servico/processo
    $occupant = Get-PortOccupant
    if ($occupant) {
        Write-Host "[ERRO] A porta $PORT ja esta sendo usada pelo processo '$($occupant.Name)' (PID $($occupant.Pid))."
        Write-Host "Por favor, encerre o outro processo antes de iniciar o servidor."
        return
    }

    Write-Host "Iniciando servidor Qualis CAPES em http://127.0.0.1:$PORT ..."

    # Inicia o processo python de forma oculta e independente (background real no Windows)
    try {
        $proc = Start-Process -FilePath "python" -ArgumentList "-m uvicorn api.main:app --port $PORT --host 127.0.0.1" -WindowStyle Hidden -WorkingDirectory $PSScriptRoot -PassThru
    } catch {
        Write-Host "[ERRO] Nao foi possivel iniciar o Python. Verifique se o comando 'python' esta no PATH do sistema."
        return
    }

    Start-Sleep -Seconds 3

    $svcPid = Find-ServerPid
    if ($svcPid) {
        $svcPid | Out-File $PID_FILE -Encoding ascii
        Write-Host "Servidor iniciado com sucesso (PID $svcPid)."
        Write-Host "Acesse: http://127.0.0.1:$PORT"
    } else {
        # Se iniciou mas nao achou o PID de imediato, pode ser um atraso na inicializacao
        if ($proc -and -not $proc.HasExited) {
            Start-Sleep -Seconds 3
            $svcPid = Find-ServerPid
        }
        
        if ($svcPid) {
            $svcPid | Out-File $PID_FILE -Encoding ascii
            Write-Host "Servidor iniciado com sucesso (PID $svcPid)."
            Write-Host "Acesse: http://127.0.0.1:$PORT"
        } else {
            Write-Host "[ERRO] O servidor foi iniciado, mas nao esta respondendo na porta $PORT."
            Write-Host "Verifique se ha erros executando diretamente: python -m uvicorn api.main:app --port $PORT"
            if ($proc -and -not $proc.HasExited) {
                $proc.Kill()
            }
        }
    }
}

function Stop-Server {
    $svcPid = Find-ServerPid
    if (-not $svcPid) {
        # Caso o PID nao esteja mais ouvindo na porta, tenta ler do arquivo .server_pid como fallback
        if (Test-Path $PID_FILE) {
            $svcPid = Get-Content $PID_FILE -ErrorAction SilentlyContinue
        }
    }

    if (-not $svcPid -or $svcPid -notmatch "^\d+$") {
        Write-Host "Nenhum servidor rodando."
        Remove-Item $PID_FILE -Force -ErrorAction SilentlyContinue
        return
    }

    Write-Host "Parando servidor (PID $svcPid)..."
    $proc = Get-Process -Id $svcPid -ErrorAction SilentlyContinue
    if ($proc) { 
        $proc.Kill()
        $proc.WaitForExit(5000) 
    }

    # Aguarda a porta liberar completamente
    Start-Sleep -Seconds 1
    Remove-Item $PID_FILE -Force -ErrorAction SilentlyContinue
    Write-Host "Servidor parado com sucesso."
}

function Get-Status {
    $svcPid = Find-ServerPid
    if ($svcPid) {
        Write-Host "Servidor RODANDO (PID $svcPid) em http://127.0.0.1:$PORT"
    } else {
        Write-Host "Servidor PARADO"
    }
}

switch ($Action) {
    "start"   { Start-Server }
    "stop"    { Stop-Server }
    "restart" { Stop-Server; Start-Server }
    "status"  { Get-Status }
}
