"""Roadmap-derived project checklists. These definitions contain no earned progress."""
project_milestones = []


def add(id, project, title, description, done, hints, phases, tasks, optional=False, exit_review=False):
    project_milestones.append({
        'id': id, 'projectId': project, 'title': title,
        'description': description, 'doneWhen': done, 'evidenceHints': hints,
        'optional': optional, 'kind': 'exit_review' if exit_review else 'work',
        'phaseIds': phases,
        'sourceSection': f'ROADMAP.md §3 {"Phases 5–6 and parallel FPGA track" if project == "project-4" else {"project-1":"Phase 2","project-2":"Phase 3","project-3":"Phase 4"}[project]}; §9 measurement rules; §10 master checklist',
        'tasks': [{'id': f'{id}-{suffix}', 'title': label, 'doneWhen': criteria} for suffix, label, criteria in tasks],
    })

# Project 1: correct replayable low-latency software before optimization claims.
add('p1-order-contract','project-1','Order operations and correctness contract',
    'Define the matching engine behavior before timing it. Order modification is supported only if included in the chosen contract.',
    'Add, cancel and execute operations have explicit expected behavior; supported modification semantics and corner cases are documented.',
    ['Correctness contract','Operation tests'],['phase-2'],[
        ('operations','Implement the order operations','Add, cancel and execute orders according to a written contract; document whether modify is supported.'),
        ('corner-cases','Test defined corner cases','Tests exercise the chosen order-book rules and reject invalid operations consistently.'),
    ])
add('p1-replay','project-1','Deterministic replay and reference validation',
    'Keep a slower reference implementation to distinguish correctness from speed.',
    'The same event stream produces deterministic results and agrees with the slower reference.',
    ['Replay fixture and seed','Reference comparison output'],['phase-2'],[
        ('replay','Replay a deterministic event stream','Persist a controlled event stream or generator seed and verify reproducible engine outputs.'),
        ('reference','Compare with a reference engine','Validate the optimized candidate against the slower reference across the documented workloads.'),
    ])
add('p1-benchmarks','project-1','Controlled workloads and tail-latency baseline',
    'Measure a correct baseline under several workload distributions.',
    'Raw repeated measurements report throughput and p50/p95/p99 with workload, hardware and compiler configuration.',
    ['Workload generator','Raw timings','Benchmark invocation and machine/compiler details'],['phase-2'],[
        ('workloads','Pin the benchmark inputs','Record sizes, distributions, seeds and correctness checks for multiple controlled workloads.'),
        ('latency','Measure throughput and latency distribution','Use warmup and repeated runs; retain raw data and p50/p95/p99 rather than one best run.'),
        ('configuration','Record the test environment','Capture hardware, compiler, optimization flags and how setup is excluded from measured work.'),
    ])
add('p1-optimization','project-1','Three measured optimization investigations',
    'Investigate layout, allocation, queue structure or other measured bottlenecks; keep regressions as evidence.',
    'At least three controlled changes have correctness checks, baseline/change measurements and explanations, including negative results.',
    ['Experiment log','Profiler capture','Before/after raw data'],['phase-2'],[
        ('experiments','Investigate at least three changes','For each hypothesis, change one controlled factor and rerun correctness and performance measurements.'),
        ('negative-results','Explain retained and rejected changes','Retain regressions and use profiler evidence to explain the resulting tradeoffs.'),
    ])
add('p1-exit-review','project-1','Matching-engine portfolio exit review',
    'Review the whole project definition of done after the required work milestones, using saved evidence rather than reading or quiz progress.',
    'A correct replayable engine, reproducible workloads, throughput/tail latency, environment details and a profiler-backed optimization writeup are available.',
    ['Repository README and test instructions','Optimization report','Technical article'],['phase-2','phase-7'],[
        ('reproducibility','Audit build, tests and replay instructions','A reader can build, run correctness tests and reproduce the controlled benchmarks from documented commands.'),
        ('results','Audit the complete performance report','Review workload fairness, p50/p95/p99, throughput, hardware/compiler setup, profiler evidence and three investigations including regressions.'),
        ('writeup','Prepare the project story','Write problem → baseline → hypothesis → optimization → actual results → limitations without unsupported speedup claims.'),
    ],exit_review=True)

# Project 2: each kernel remains part of the one KernelForge library/suite.
add('p2-vector-add','project-2','Vector-add kernel and GPU timing',
    'Begin KernelForge with CUDA execution-model practice and a controlled timing method.',
    'Vector addition matches a CPU reference at boundary sizes and has reproducible GPU timing.',
    ['CUDA source','Reference tests','Timing script'],['phase-3'],[
        ('correctness','Implement and validate vector addition','Check CPU/GPU agreement, including inputs that do not evenly fill a block.'),
        ('timing','Separate kernel and transfer time','Document warmup, repetition and the boundaries of the GPU measurement.'),
    ])
add('p2-reduction','project-2','Parallel reduction',
    'Build a correct reduction before interpreting its bandwidth or occupancy.',
    'The reduction agrees with reference semantics/tolerances and is measured over controlled sizes.',
    ['Reduction tests','Benchmark output'],['phase-3'],[
        ('kernel','Implement reduction with reference checks','Exercise several sizes and numerical edge cases using documented tolerances.'),
        ('measurement','Record reduction measurements','Retain controlled repeated measurements and explain the measured data-access behavior.'),
    ])
add('p2-scan','project-2','Parallel prefix scan',
    'Make inclusive/exclusive scan semantics explicit in the kernel suite.',
    'A parallel scan has documented semantics, reference validation and repeatable measurements.',
    ['Scan contract and tests','Raw timings'],['phase-3'],[
        ('kernel','Implement and test prefix scan','Document inclusive or exclusive behavior and validate edge and nonuniform input sizes against a reference.'),
        ('measurement','Benchmark the validated scan','Record input configuration, timing boundaries and repeated results.'),
    ])
add('p2-gemm','project-2','Naive and shared-memory tiled GEMM',
    'Compare a naive matrix multiplication with a tiled implementation using controlled inputs.',
    'Both GEMM versions pass numerical checks; the effect of tiling is measured and explained.',
    ['Naive/tiled source','Numerical tests','GEMM timing data'],['phase-3'],[
        ('naive','Establish a correct naive GEMM','Validate matrix dimensions and reference tolerances before optimization.'),
        ('tiled','Implement shared-memory tiling','Validate the tiled kernel and compare it with the naive baseline under the same inputs.'),
    ])
add('p2-heavy-kernel','project-2','Convolution or related compute-heavy kernel',
    'Choose one additional compute-heavy kernel; this is not a requirement to build several unrelated kernels.',
    'One convolution or related kernel has reference tests and measured behavior.',
    ['Kernel selection rationale','Correctness tests','Benchmark data'],['phase-3'],[
        ('implementation','Implement the selected kernel','Document the operation and validate its output against a meaningful reference.'),
        ('experiment','Measure a controlled kernel experiment','Use fixed inputs and reproducible timing to explain a relevant bottleneck or optimization.'),
    ])
add('p2-baselines','project-2','Meaningful CPU and NVIDIA library comparisons',
    'Use relevant optimized baselines rather than an intentionally weak CPU implementation.',
    'Comparisons use a relevant optimized CPU baseline and NVIDIA libraries where sensible, including cuBLAS for GEMM.',
    ['Baseline code/configuration','cuBLAS comparison','Raw comparison data'],['phase-3'],[
        ('cpu','Establish a fair CPU comparison','Document the CPU implementation, hardware, precision and workload; avoid a deliberately unoptimized baseline.'),
        ('libraries','Compare with relevant NVIDIA libraries','Include cuBLAS for GEMM and explain where library comparisons are or are not applicable.'),
    ])
add('p2-profiling','project-2','Nsight bottleneck experiments',
    'Use profiler evidence to interpret memory traffic, bandwidth and occupancy where meaningful.',
    'Nsight evidence supports the reported bottlenecks and measured optimizations.',
    ['Nsight Compute captures','Experiment notes','Reproduction commands'],['phase-3'],[
        ('capture','Profile meaningful kernel workloads','Capture memory bandwidth, bottlenecks and occupancy where relevant on a compatible NVIDIA system.'),
        ('interpret','Explain optimization outcomes','Connect profiler observations to raw benchmark data, including unsuccessful changes and limitations.'),
    ])
add('p2-exit-review','project-2','KernelForge portfolio exit review',
    'Review the complete correct, reproducible kernel suite and technical report.',
    'Vector addition, reduction, scan, naive/tiled GEMM and a compute-heavy kernel have tests, fair baselines, measured optimizations and a technical report.',
    ['Suite README/tests','Benchmark scripts and raw data','Technical report/article'],['phase-3','phase-7'],[
        ('suite','Audit the complete kernel suite','Confirm all listed kernels and reproducible correctness/benchmark commands are included.'),
        ('comparisons','Audit baseline and profiler evidence','Review CPU/library fairness, precision, transfer/kernel boundaries, Nsight data and measurement variation.'),
        ('writeup','Publish an evidence-based technical report','Explain problem, baseline, hypothesis, changes, actual results and limitations with setup instructions and retained raw data.'),
    ],exit_review=True)

# Project 3: a small supported model, not an assumed universal TensorRT setup.
add('p3-reference','project-3','Supported model and reference baseline',
    'Choose a small supported model and a compatible NVIDIA environment before serving experiments.',
    'The exact model, held-out accuracy test and latency baseline are recorded with environment/precision details.',
    ['Model/version selection','Reference accuracy output','Baseline timing/configuration'],['phase-4'],[
        ('model','Confirm model and tool compatibility','Record the selected small model and compatible GPU, driver, CUDA and TensorRT environment.'),
        ('baseline','Measure reference accuracy and latency','Fix the test set/model version and retain reference metrics plus a controlled latency baseline.'),
    ])
add('p3-runtime','project-3','C++ inference runtime and end-to-end correctness',
    'Build the runtime with TensorRT where compatible with the chosen environment.',
    'A working C++ runtime runs the selected model end to end and passes reference correctness checks.',
    ['Runtime source','Setup instructions','End-to-end test output'],['phase-4'],[
        ('implementation','Build the C++ runtime','Load and run the supported model in the documented compatible NVIDIA environment.'),
        ('correctness','Validate the serving path','Check preprocessing/inference outputs and numerical tolerances against the reference.'),
    ])
add('p3-preprocessing','project-3','Custom CUDA preprocessing',
    'Integrate preprocessing without silently changing model input semantics.',
    'CUDA preprocessing matches the reference and is included in separate and end-to-end timing boundaries.',
    ['Preprocessing kernel/tests','Numerical comparison','Timing trace'],['phase-4'],[
        ('kernel','Implement and validate preprocessing','Compare CUDA-produced model inputs with the reference implementation on controlled cases.'),
        ('integration','Measure preprocessing in the pipeline','Record its compute/transfer contribution without hiding it from end-to-end latency.'),
    ])
add('p3-concurrency','project-3','Batching, streams and overlap experiments',
    'Study request queueing, batching policy, stream behavior and asynchronous transfers under load.',
    'Controlled experiments explain batching/stream/overlap tradeoffs without sacrificing correctness.',
    ['Load generator','Profiler traces','Experiment log'],['phase-4'],[
        ('batching','Explore batching and request load','Compare documented batching policies at multiple load levels with correctness and latency checks.'),
        ('streams','Explore streams and transfer overlap','Use CUDA streams/events and profiler evidence to measure asynchronous execution and overlap.'),
    ])
add('p3-load-curves','project-3','Throughput versus latency curves',
    'Report throughput and tail latency together, separating queueing, transfers and compute.',
    'Multiple controlled load levels produce reproducible throughput/latency curves and p95/p99 with fair baselines.',
    ['Raw load measurements','Throughput/latency plots','Hardware/software configuration'],['phase-4'],[
        ('curves','Generate controlled load curves','Retain repeated measurements across load levels, reporting throughput and p95/p99 rather than only peak throughput.'),
        ('boundaries','Audit timing and baseline fairness','Separate setup, preprocessing, transfers, inference and end-to-end response time; pin model/precision/test inputs.'),
    ])
add('p3-precision','project-3','Supported precision/accuracy experiment',
    'Where supported, evaluate FP32/FP16/INT8 changes with the exact accuracy test set. Unsupported paths are limitations, not measured results.',
    'A supported precision change has measured quality/performance tradeoffs on the fixed test set, with numerical conventions documented.',
    ['Precision compatibility note','Accuracy comparison','Timing data'],['phase-4'],[
        ('accuracy','Evaluate a supported precision change','Use the exact held-out accuracy set and document numerical error/quality changes.'),
        ('performance','Measure the supported tradeoff','Compare controlled timing and throughput at the selected precisions without claiming unsupported modes.'),
    ],optional=True)
add('p3-exit-review','project-3','Inference-runtime portfolio exit review',
    'Audit the working runtime, profiler evidence and fair comparisons; optional precision studies must be labeled by actual support.',
    'The runtime works end to end with tests, profiler data, loaded-system curves, a documented baseline and accuracy/precision limitations.',
    ['Working runtime README','Profiler/benchmark report','Runtime demo and technical article'],['phase-4','phase-7'],[
        ('reproduce','Audit runtime setup and correctness','A reader can configure the compatible environment and run end-to-end correctness tests.'),
        ('report','Audit complete inference measurements','Review batching/streams/overlap, throughput/latency curves, accuracy, precision used and limitations with raw data.'),
        ('demonstrate','Prepare the runtime demonstration and story','Record a working demo and write actual baseline/hypothesis/results/limitations without unsupported improvement claims.'),
    ],exit_review=True)

# Project 4: all hardware exercises belong to ONE integrated capstone.
add('p4-rtl','project-4','Verified RTL building blocks',
    'The early parallel FPGA exercises are milestones of this capstone, not extra portfolio projects.',
    'Counters/FSM, an 8-bit ALU and signed fixed-point MAC have self-checking simulations and documented reset/overflow behavior.',
    ['RTL/testbench source','Simulation output','Fixed-point/reset notes'],['phase-1','phase-2','phase-5'],[
        ('logic','Verify counters, FSM and 8-bit ALU','Use self-checking testbenches with expected outputs and corner cases; explain combinational/sequential behavior.'),
        ('mac','Verify signed fixed-point MAC behavior','Document overflow/saturation, reset/clock semantics and pipeline behavior against a numerical model.'),
    ])
add('p4-dot-product','project-4','Pipelined dot product and synthesis reports',
    'Connect pipelining/HLS scheduling choices to actual resources and timing.',
    'A synthesized pipelined dot product has validated output and recorded LUT/FF/DSP/BRAM, timing and initiation interval.',
    ['HLS/RTL source','Synthesis/timing reports','Scheduling comparison'],['phase-3','phase-5'],[
        ('kernel','Synthesize a validated dot product','Check known vectors and produce a synthesis report using a compatible toolchain.'),
        ('reports','Interpret resource and timing tradeoffs','Record achieved timing, II and utilization; explain clock constraints, critical-path/slack, reset/clock-domain risks and measured PIPELINE/UNROLL/partitioning or pipeline choices.'),
    ])
add('p4-fir','project-4','Fixed-point FIR or preprocessing block',
    'Verify a reusable arithmetic block within the same capstone; final integration depends on data-path value.',
    'A fixed-point FIR/preprocessor agrees with a C++ reference on known vectors.',
    ['FIR/preprocessor source','C++ reference vectors','Numerical test output'],['phase-5'],[
        ('block','Implement the fixed-point block','Document its representation and verify outputs against a C++ reference.'),
        ('verification','Record known-vector and corner-case tests','Retain test inputs/outputs and describe pipeline or resource tradeoffs; explain whether integration helps.'),
    ])
add('p4-overlay','project-4','Physical PYNQ-Z2 overlay and control',
    'Verify board and toolchain support before claiming a working physical design.',
    'A compatible bitstream/overlay loads on physical PYNQ-Z2 and a host-side driver controls the design.',
    ['Compatibility decision','Overlay/bitstream and driver source','Physical load/control log'],['phase-4','phase-5'],[
        ('toolchain','Confirm the supported board build flow','Record compatible Vivado/Vitis/PYNQ versions, board files and the x86-64 development environment.'),
        ('control','Load and control the physical overlay','Use the physical board and documented PYNQ/AXI4-Lite control path, not simulation alone.'),
    ])
add('p4-dma','project-4','Verified AXI/DMA data path',
    'Move data from the Zynq ARM processing system to programmable logic and back.',
    'A supported physical AXI/stream/DMA path round-trips known vectors that match the C++ reference.',
    ['Host/DMA driver source','Known-vector output','Buffer/transfer checks'],['phase-5'],[
        ('transfer','Run a physical PS/PL round trip','Verify actual transfer length, data format, alignment and cache-coherency behavior.'),
        ('numerics','Compare hardware outputs with the reference','Retain known vectors and separate hardware-core timing from ARM/host/DMA overhead.'),
    ])
add('p4-dataset','project-4','Labeled motion windows and leakage-free splits',
    'Start from offline six-axis IMU recordings; reuse existing sensor experience where practical without requiring live-sensor integration.',
    'Motion recordings are labeled and split into train/validation/test sets without leakage.',
    ['Dataset manifest','Labeling/split policy','Preprocessing script'],['phase-6'],[
        ('recordings','Collect and label motion windows','Document six-axis window construction and class labels from offline recordings.'),
        ('splits','Establish independent data splits','Record a leakage-free train/validation/test split and preserve its identifiers/seeds.'),
    ])
add('p4-fp32','project-4','Compact FP32 gesture-classifier baseline',
    'The suggested 64×6 → Dense32 → Dense16 → 4 network is illustrative, not a guaranteed FPGA fit.',
    'A small FP32 model has held-out metrics and a confusion matrix; model/version/input semantics are recorded.',
    ['Training configuration/model version','Held-out metrics','Confusion matrix'],['phase-6'],[
        ('training','Train the compact FP32 reference','Use the fixed splits and document the actual architecture instead of assuming the illustrative model fits.'),
        ('evaluation','Record baseline quality','Log held-out metrics and confusion matrix with reproducible preprocessing/model versions.'),
    ])
add('p4-int8','project-4','INT8 quantization and buffer budget',
    'Make numerical conventions and memory budgets explicit before fitting hardware.',
    'INT8 weights/activations are validated on held-out data, with scaling/fixed-point conventions and buffer-size estimates.',
    ['Quantization configuration','FP32/INT8 accuracy comparison','Weight/activation buffer budget'],['phase-6'],[
        ('quantize','Quantize and validate INT8','Record scales/zero points or fixed-point conventions and evaluate the exact held-out test set.'),
        ('budget','Estimate on-chip storage needs','Estimate weights, activations and intermediate buffers before synthesis; retain resource-driven model revisions.'),
    ])
add('p4-software-baselines','project-4','Equivalent CPU C++ and CUDA inference',
    'Use equivalent numerical semantics for a fair cross-platform comparison.',
    'CPU and CUDA implementations match the selected model/quantization semantics within documented tolerances.',
    ['C++/CUDA baseline source','Numerical validation output','Platform configurations'],['phase-6'],[
        ('cpu','Validate the CPU C++ baseline','Run reference comparisons with fixed model inputs and documented precision/tolerances.'),
        ('cuda','Validate the CUDA baseline','Run equivalent GPU inference and record hardware, versions and matching numerical semantics.'),
    ])
add('p4-deployment','project-4','Fit and deploy quantized FPGA inference',
    'Prioritize a confirmed hls4ml/PYNQ-Z2 flow or a small handwritten HLS datapath if conversion is blocked. Do not assume modern FINN targets this board.',
    'A fit-to-device network runs real inference on physical PYNQ-Z2 with numerical validation and synthesis/place-route reports.',
    ['Supported flow or fallback rationale','Design/overlay/driver source','Physical inference and timing/utilization reports'],['phase-6'],[
        ('implementation','Build a supported quantized implementation','Use confirmed hls4ml tooling or a small HLS fallback; resize the model based on real resource/timing results.'),
        ('hardware','Run validated inference on the board','Create/load the supported overlay, compare physical outputs with references and record achieved clock/utilization.'),
    ])
add('p4-comparison','project-4','Fair CPU/GPU/FPGA comparison',
    'Separate compute-only and end-to-end timing, including transfers; energy is reported only where measurably available.',
    'Reproducible comparisons report latency, throughput, numerical accuracy, LUT/FF/DSP/BRAM and clock with fair boundaries and limitations.',
    ['Raw benchmark scripts/data','Timing/resource/accuracy report','Power methodology or explicit not-measured note'],['phase-6'],[
        ('timing','Compare compute and end-to-end performance','Measure CPU/GPU/FPGA under controlled inputs, reporting core, transfer and host/board response boundaries separately.'),
        ('costs','Report quality, resources and measurement limits','Record accuracy, achieved clock, utilization and power/energy methodology where available; label unmeasured costs.'),
    ])
add('p4-int4','project-4','INT4 experiment — optional',
    'Attempt only when the model/tool flow supports it and measured data justifies lower precision.',
    'A supported INT4 experiment reports actual held-out quality and resource/performance tradeoffs against INT8.',
    ['Support/rationale note','INT8/INT4 quality and measurement comparison'],['phase-6'],[
        ('support','Confirm support and a measured reason','Establish that the chosen conversion/model flow supports INT4 and the experiment is justified.'),
        ('experiment','Evaluate the lower-precision tradeoff','Retain held-out metrics and controlled measurements without claiming unsupported device behavior.'),
    ],optional=True)
add('p4-runtime-weights','project-4','Runtime-loaded weights — optional',
    'Attempt after the base accelerator works and resources/tooling permit; this remains part of the same capstone.',
    'Weights can change between inference runs without rebuilding the bitstream, with correctness and resource evidence.',
    ['Runtime weight-buffer source','Changed-weight correctness tests','Resource/timing comparison'],['phase-6'],[
        ('fit','Confirm the base accelerator and spare budget','Use a working physical baseline and real synthesis results before adding a runtime weight buffer.'),
        ('load','Verify changed weights without a rebuild','Change weights between runs, validate output semantics and document the implementation cost.'),
    ],optional=True)
add('p4-double-buffer','project-4','Weight double-buffering — stretch',
    'A stretch extension of optional runtime-loaded weights, never a baseline completion requirement.',
    'A supported double-buffered weight path is correct and its benefit/cost is measured against the simpler weight buffer.',
    ['Double-buffer implementation/tests','Controlled overlap/resource comparison'],['phase-6'],[
        ('baseline','Establish working runtime-loaded weights','Confirm the simpler optional weight-buffer implementation before attempting double buffering.'),
        ('experiment','Measure double-buffering tradeoffs','Validate updates/inference and retain measured overlap, resource and timing outcomes, including regressions.'),
    ],optional=True)
add('p4-exit-review','project-4','Single-capstone portfolio exit review',
    'Review the integrated physical-board capstone. Optional INT4/runtime weights/double buffering do not gate baseline completion.',
    'A physical PYNQ-Z2 demo, bitstream/design/driver source, tests, synthesis/timing reports and fair CPU/GPU/FPGA benchmarks are available.',
    ['Physical board demo','Repository/setup/test instructions','Synthesis/timing and cross-platform report','Technical article'],['phase-6','phase-7'],[
        ('physical-proof','Audit physical deployment and correctness','Confirm the fit-to-device quantized network, supported overlay/data path, known-vector tests and held-out accuracy on the physical board.'),
        ('reproducibility','Audit all required source and reports','Include bitstream/design files, driver, tests, benchmark scripts/raw data, resource/timing reports and fair CPU/GPU/FPGA boundaries.'),
        ('story','Prepare the capstone demo and article','Communicate baseline, design choices, actual results, limitations and power methodology; clearly label optional work and unmeasured claims.'),
    ],exit_review=True)
