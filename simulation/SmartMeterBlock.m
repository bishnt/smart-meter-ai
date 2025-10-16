classdef SmartMeterBlock < matlab.System & matlab.system.mixin.Propagates
    % SmartMeterBlock - Simulink block for smart meter simulation
    % - Can accept waveform samples (recommended) or precomputed quantities
    % - Computes Vrms, Irms, fundamental phasors, Active/Reactive/Apparent power
    %   based on fundamental extraction (approx IEEE-1459 style)
    % - Supports Influx line protocol (Telegraf) and a simulated DLMS/COSEM JSON

    
    properties (Nontunable)
        MeterId = 'METER_001'              % Unique meter identifier
        NodeType = 'consumer'              % Node type: consumer, prosumer, grid
        TelegrafHost = 'localhost'         % Telegraf ingestion gateway host
        TelegrafPort = 8094                % Telegraf TCP input port
        TransportProtocol = 'tcp'          % 'tcp' or 'udp'
        SendInterval = 1                   % Send data every N seconds (seconds)
        CommunicationFormat = 'influx'     % 'influx' or 'dlms' (simulated)
        UseWaveformInput = true            % If true, inputs are waveform vectors (voltage, current)
        SamplingRate = 4800                % Hz - sampling rate of input waveforms
        FundamentalFreq = 50               % Hz - expected nominal fundamental frequency
        HMACKey = ''                       % If non-empty, message will be HMAC-SHA256 signed
        TimeSync = 'none'                  % 'none' or 'ntp' (note: ntp call is best-effort)
    end
    
    properties (Access = private)
        TcpClient = []                      % TCP/UDP connection object
        LastSendTime = datetime(1970,1,1)   % time of last send (UTC)
        SampleCount = 0                     % Counter for samples sent
        IsConnected = false                 % Connection status
    end
    
    methods (Access = protected)
        function setupImpl(obj)
            % Initialize the TCP/UDP connection
            % NOTE: For real deployment add TLS and certificate checks.
            try
                if strcmp(obj.TransportProtocol, 'tcp')
                    obj.TcpClient = tcpclient(obj.TelegrafHost, obj.TelegrafPort, ...
                        'Timeout', 10, 'ConnectTimeout', 10);
                    obj.IsConnected = true;
                    disp(['[SmartMeter: ' obj.MeterId '] Connected to Telegraf via TCP at ' ...
                        obj.TelegrafHost ':' num2str(obj.TelegrafPort)]);
                elseif strcmp(obj.TransportProtocol, 'udp')
                    obj.TcpClient = udpport("datagram", "LocalPort", 0);
                    obj.IsConnected = true;
                    disp(['[SmartMeter: ' obj.MeterId '] Configured for UDP to ' ...
                        obj.TelegrafHost ':' num2str(obj.TelegrafPort)]);
                else
                    error('Unsupported transport protocol. Use "tcp" or "udp".');
                end
            catch ME
                warning(['[SmartMeter: ' obj.MeterId '] Connection failed: ' ME.message]);
                obj.IsConnected = false;
            end
            
            % Attempt best-effort NTP sync if requested (simulation only).
            if strcmpi(obj.TimeSync, 'ntp')
                try
                    % This is best-effort and system-dependent. Keep as advisory.
                    system('ntpdate -q pool.ntp.org'); %#ok<SYSERR>
                    disp('[SmartMeter] Attempted NTP time query (system call).');
                catch
                    warning('[SmartMeter] NTP request failed or not permitted.');
                end
            end
        end
        
        function [y1, y2] = stepImpl(obj, varargin)
            % If UseWaveformInput==true:
            %   inputs: voltageSamples (vector), currentSamples (vector)
            % Else:
            %   inputs: pActive, pReactive, voltage, current, frequency, timeOfUse, energyKwh, maxDemandKw, costValue
            %
            % Outputs: dataStatus (1=sent,0=not sent,-1=tx error), timestamp (ns since epoch)
            
            obj.SampleCount = obj.SampleCount + 1;
            nowUtc = datetime('now','TimeZone','UTC');
            elapsed = seconds(nowUtc - obj.LastSendTime);
            dataStatus = 0;
            
            try
                if obj.UseWaveformInput
                    % Expect exactly 2 inputs
                    voltageSamples = varargin{1};
                    currentSamples = varargin{2};
                    
                    % Validate vector lengths
                    if isempty(voltageSamples) || isempty(currentSamples) || numel(voltageSamples)~=numel(currentSamples)
                        error('Waveform inputs must be non-empty vectors of equal length.');
                    end
                    
                    % Compute measurement window parameters
                    N = numel(voltageSamples);
                    fs = obj.SamplingRate;
                    t = (0:N-1)'/fs;
                    
                    % Anti-alias: windowing (Hann) - not a substitute for hardware anti-alias filter
                    w = hann(N);
                    v_w = voltageSamples(:).*w;
                    i_w = currentSamples(:).*w;
                    
                    % Compute RMS values (IEEE-style: true RMS)
                    Vrms = sqrt(mean(v_w.^2));
                    Irms = sqrt(mean(i_w.^2));
                    
                    % Instantaneous active power (time domain average)
                    P_inst = mean(v_w .* i_w); % active power (watts)
                    
                    % Compute fundamental phasors using FFT around fundamental bin
                    % This gives us a way to estimate phase angle between v and i at fundamental.
                    % Using simple DFT: V1 = sum(v * exp(-j*2*pi*k/N*n))
                    kFund = round(obj.FundamentalFreq * N / fs) + 1; % MATLAB 1-indexed
                    V_fft = fft(v_w);
                    I_fft = fft(i_w);
                    % pick bins carefully (wrap if necessary)
                    % Use complex phasor at kFund (note: fft output indexing)
                    if kFund > N
                        kFund = mod(kFund-1, N) + 1;
                    end
                    V1 = V_fft(kFund);
                    I1 = I_fft(kFund);
                    
                    % Fundamental apparent power magnitude
                    S_fund = abs(V1)*abs(I1)/N^2; % scale depends on FFT normalization
                    % A more robust S estimate is Vrms_fund * Irms_fund
                    Vrms_fund = abs(V1)/N/sqrt(2);
                    Irms_fund = abs(I1)/N/sqrt(2);
                    S = Vrms_fund * Irms_fund;
                    
                    % Estimate P_fund using real part of phasor product
                    P_fund = real((V1 * conj(I1)))/(N^2);
                    % Reactive power (fundamental) approximate
                    Q_fund = imag((V1 * conj(I1)))/(N^2);
                    
                    % Compose outputs with IEEE-style naming
                    pActive = P_inst;                    % total active (includes harmonics)
                    pReactive = Q_fund;                  % fundamental reactive estimate
                    voltage = Vrms;                      % total Vrms
                    current = Irms;                      % total Irms
                    frequency = obj.FundamentalFreq;     % best-effort fundamental
                    energyKwh = NaN;                      % cumulative energy must be integrated externally
                    maxDemandKw = NaN;
                    timeOfUse = '';                       % not derived here
                    costValue = NaN;
                    
                    % Note: we expose both fundamental and total where possible
                    meta.Vrms_fund = Vrms_fund;
                    meta.Irms_fund = Irms_fund;
                    meta.P_fund = P_fund;
                    meta.Q_fund = Q_fund;
                    meta.S = S;
                    meta.N = N;
                    
                else
                    % Old interface: user provides computed values
                    if numel(varargin) < 9
                        error('Expected 9 inputs when UseWaveformInput is false.');
                    end
                    pActive = varargin{1};
                    pReactive = varargin{2};
                    voltage = varargin{3};
                    current = varargin{4};
                    frequency = varargin{5};
                    timeOfUse = varargin{6};
                    energyKwh = varargin{7};
                    maxDemandKw = varargin{8};
                    costValue = varargin{9};
                    meta = struct();
                end
                
                % Send data if interval elapsed or first send
                if elapsed >= obj.SendInterval || obj.SampleCount == 1
                    if obj.IsConnected
                        % Build message according to chosen format
                        timestamp_ns = int64(posixtime(nowUtc) * 1e9); % ns since epoch UTC
                        
                        if strcmpi(obj.CommunicationFormat, 'influx')
                            lineProtocol = obj.buildLineProtocolInflux(...
                                pActive, pReactive, voltage, current, frequency, ...
                                timeOfUse, energyKwh, maxDemandKw, costValue, timestamp_ns);
                            payload = lineProtocol;
                        else
                            % build simulated DLMS/COSEM JSON with OBIS-like keys
                            dlmsMsg = obj.buildDLMSPayload(...
                                pActive, pReactive, voltage, current, frequency, ...
                                timeOfUse, energyKwh, maxDemandKw, costValue, timestamp_ns, meta);
                            payload = jsonencode(dlmsMsg);
                        end
                        
                        % If HMAC key provided, sign the payload and append signature
                        if ~isempty(obj.HMACKey)
                            sig = obj.hmacSha256Hex(payload, obj.HMACKey);
                            envelope.payload = payload;
                            envelope.hmac = sig;
                            envelope.meter_id = obj.MeterId;
                            envelope.timestamp_ns = timestamp_ns;
                            sendStr = jsonencode(envelope);
                        else
                            sendStr = payload;
                        end
                        
                        % Transmit
                        obj.sendToTelegraf(sendStr);
                        dataStatus = 1;
                        obj.LastSendTime = nowUtc;
                    else
                        warning('[SmartMeter] Not connected - skipping send.');
                        dataStatus = 0;
                    end
                end
                
            catch ME
                warning(['[SmartMeter: ' obj.MeterId '] Error in stepImpl: ' ME.message]);
                dataStatus = -1;
            end
            
            % Outputs
            y1 = dataStatus;
            y2 = int64(posixtime(nowUtc) * 1e9); % timestamp in ns since epoch
        end
        
        function line = buildLineProtocolInflux(~, pActive, pReactive, voltage, ...
                                                current, frequency, timeOfUse, ...
                                                energyKwh, maxDemandKw, costValue, timestamp_ns)
            % Build InfluxDB line protocol format for Telegraf ingestion
            % Keep same naming but ensure numeric formatting and escaped tags
            % measurement,tag1=value1 tag1=1.23,tag2=4.56 timestamp
            realtimeMsg = sprintf('realtime_readings p_active=%.6f,p_reactive=%.6f,voltage=%.6f,current=%.6f,frequency=%.6f %d', ...
                pActive, pReactive, voltage, current, frequency, timestamp_ns);
            
            aggregatedMsg = sprintf('aggregated_usage energy_kwh=%.6f,max_demand_kw=%.6f %d', ...
                energyKwh, maxDemandKw, timestamp_ns);
            
            costMsg = sprintf('meter_cost total_cost=%.6f %d', costValue, timestamp_ns);
            
            % Combine; Influx line protocol expects separate lines
            line = sprintf('%s\n%s\n%s\n', realtimeMsg, aggregatedMsg, costMsg);
        end
        
        function dlmsObj = buildDLMSPayload(obj, pActive, pReactive, voltage, current, frequency, ...
                                            timeOfUse, energyKwh, maxDemandKw, costValue, timestamp_ns, meta)
            % Build a simulated DLMS/COSEM payload (JSON) with OBIS-like identifiers.
            % This is NOT a full DLMS implementation — it's a structured payload
            % that mirrors the logical measurand mapping for later mapping to real DLMS.
            dlmsObj.meter_id = obj.MeterId;
            dlmsObj.node_type = obj.NodeType;
            dlmsObj.timestamp_ns = timestamp_ns;
            dlmsObj.measurements = struct( ...
                '1-0:1.8.0', energyKwh, ...     % Active energy (kWh) - example OBIS
                '1-0:2.8.0', NaN, ...           % Reactive energy example
                '1-0:16.7.0', pActive, ...      % Active power (W)
                '1-0:3.7.0', pReactive, ...     % Reactive power (var)
                '1-0:32.7.0', voltage, ...      % Voltage (V)
                '1-0:31.7.0', current, ...      % Current (A)
                '1-0:14.7.0', frequency ...     % Frequency (Hz)
            );
            dlmsObj.aggregates = struct( ...
                'max_demand_kw', maxDemandKw, ...
                'cost', costValue, ...
                'time_of_use', timeOfUse ...
            );
            if ~isempty(meta)
                dlmsObj.meta = meta;
            end
        end
        
        function hex = hmacSha256Hex(~, dataStr, keyStr)
            % Compute HMAC-SHA256 using Java classes (available in MATLAB JVM).
            % Returns lower-case hex string.
            import javax.crypto.Mac;
            import javax.crypto.spec.SecretKeySpec;
            keyBytes = uint8(keyStr);
            sk = SecretKeySpec(keyBytes, 'HmacSHA256');
            mac = Mac.getInstance('HmacSHA256');
            mac.init(sk);
            out = typecast(mac.doFinal(uint8(dataStr)), 'uint8'); %#ok<TCASTS>
            hex = lower(dec2hex(out)'); hex = hex(:)'; % combine to single string
        end
        
        function sendToTelegraf(obj, lineProtocol)
            % Send message to Telegraf
            try
                if strcmp(obj.TransportProtocol, 'tcp')
                    % convert to uint8 and write
                    write(obj.TcpClient, uint8(lineProtocol));
                elseif strcmp(obj.TransportProtocol, 'udp')
                    write(obj.TcpClient, uint8(lineProtocol), obj.TelegrafHost, obj.TelegrafPort);
                end
                disp(['[SmartMeter: ' obj.MeterId '] Data sent to Telegraf (len=' num2str(numel(lineProtocol)) ')']);
            catch ME
                error(['Failed to send data to Telegraf: ' ME.message]);
            end
        end
        
        function releaseImpl(obj)
            % Close connection
            try
                if ~isempty(obj.TcpClient)
                    if strcmp(obj.TransportProtocol, 'tcp')
                        clear obj.TcpClient;
                    else
                        close(obj.TcpClient);
                    end
                    disp(['[SmartMeter: ' obj.MeterId '] Connection closed']);
                end
            catch ME
                warning(['Error closing connection: ' ME.message]);
            end
        end
        
        function resetImpl(obj)
            % Reset internal states
            obj.LastSendTime = datetime(1970,1,1);
            obj.SampleCount = 0;
        end
        
                function num = getNumInputsImpl(~)
            num = 9;
        end

        function varargout = getInputNamesImpl(obj)
            varargout = {'pActive', ...
                         'pReactive', ...
                         'voltage', ...
                         'current', ...
                         'frequency', ...
                         'timeOfUse', ...
                         'energyKwh', ...
                         'maxDemandKw', ...
                         'costValue'};
        end

        
        function icon = getIconImpl(~)
            % Custom icon for the block
            icon = 'Smart Meter';
        end
    end
end
