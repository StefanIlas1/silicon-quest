
# Performance Engineering Roadmap

> **North star:** Become a hardware-aware performance engineer who can design, measure, and optimize low-level systems across CPUs, NVIDIA GPUs, and FPGAs—particularly efficient AI inference, but with skills that also transfer to infrastructure, embedded systems, and quantitative computing.
>
> **Start:** November 2026  
> **Core horizon:** 15–18 calendar months (flexible around university and internships)  
> **Typical load:** 8–12 focused hours/week, more during breaks  
> **Portfolio:** Four major projects, **only one FPGA capstone**, with smaller FPGA exercises serving as milestones within that capstone  
> **Main languages:** C++20, CUDA C++, Python, SystemVerilog/Verilog, HLS C++  
> **Operating principle:** Build and measure before claiming performance improvements.

## How to use this document in Codex

This file is the **source of truth** for the learning plan. At the start of a session:

1. Read this `ROADMAP.md` and the current repository state.
2. Ask which phase or tracked task we are working on **only if it is unclear**.
3. Suggest the next small, testable step, with a clear definition of done.
4. Teach concepts as needed. Do not complete all educational exercises without letting me attempt them first.
5. For optimizations, require a correctness test, baseline benchmark, controlled experiment, and reproducible results.
6. Update the checkbox for completed milestones **only after** implementation/evidence exists, and append a dated entry to the progress log.
7. If a course, toolchain, price, board support, or API has changed, verify against the official documentation; avoid treating dates/prices in this plan as permanent facts.

Suggested separate `AGENTS.md` instruction if useful: *Read ROADMAP.md before proposing project work. Prioritize learning, reproducibility, measured outcomes, and small incremental changes. Never invent benchmark results.*

---

## 1. What success looks like

By the end of the roadmap I should be able to:

- Explain modern C++ performance: cache hierarchy, locality, memory allocation, data layouts, contention, and concurrency.
- Profile CPU code and improve measurable p50/p95/p99 latency and/or throughput without sacrificing correctness.
- Write and optimize CUDA kernels, using coalesced memory access, shared-memory tiling, reductions, occupancy reasoning, and Nsight.
- Build a C++ GPU inference service and quantify batching, stream, transfer, and quantization tradeoffs.
- Write and simulate small RTL components, read timing/utilization reports, and understand the distinction between software and synthesizable hardware.
- Use an AMD/Xilinx Zynq/PYNQ platform with HLS/RTL, AXI, DMA, and reusable FPGA IP.
- Deploy a **small** quantized neural network to a PYNQ-Z2, compare it with CPU and GPU implementations, and separate compute time from data transfer time.
- Communicate performance work professionally: test setup, controlled inputs, profiler evidence, baselines, confidence/variation, caveats, and hardware specifics.

**Portfolio deliverables:**

1. `cpp-low-latency-engine` — optimized C++ matching engine.
2. `cuda-kernelforge` — CUDA kernel library and benchmark suite.
3. `gpu-inference-runtime` — C++/CUDA/TensorRT inference service.
4. `pynq-quantized-accelerator` — **one** integrated FPGA capstone with milestones from RTL through quantized AI inference.

## 2. Learning allocation and timeline

The learning-time split is approximate, not rigid:

| Track | Target share |
|---|---:|
| C++ / CPU / low-latency systems | 30% |
| CUDA / GPU performance | 35% |
| FPGA / RTL / hardware design | 25% |
| AI inference / ML compilers / quantization | 10% |

| Phase | Months | Main focus | Exit artifact |
|---|---|---|---|
| 1 | 1–2 | Modern C++, Linux, memory, profiling; begin digital design | CPU benchmark exercises + simple simulated RTL |
| 2 | 3–4 | CPU optimization, concurrent systems, processor architecture | Project 1: low-latency C++ matching engine |
| 3 | 5–7 | CUDA, GPU architecture, profiling | Project 2: CUDA KernelForge |
| 4 | 8–9 | GPU inference, runtime design, quantization | Project 3: GPU inference runtime |
| 5 | 10–12 | FPGA RTL/HLS, timing, AXI, DMA, PYNQ | FPGA capstone: verified hardware building blocks |
| 6 | 13–15 | Quantized model deployment and CPU/GPU/FPGA co-design | Project 4: completed PYNQ accelerator |
| 7 | 16–18 (buffer/extension) | Refine measurements, credentials, architecture depth, applications | Technical writeups, demonstrations, polished portfolio |

**Important:** FPGA preparation starts in Month 1 as a parallel track; Months 10–15 are the concentrated hardware implementation period. The last three months are optional buffer/depth, not additional mandatory projects.

### Suggested weekly rhythm (12 hours)

- **2 h** targeted textbook reading or lectures.
- **6 h** implementing the current project or hardware milestone.
- **2 h** tests, profiling, benchmarks, and debugging.
- **2 h** FPGA parallel track in early phases; later, documentation and writeups.

At exam-heavy times, preserve continuity with a small weekly progress task rather than trying to maintain full pace.

---

## 3. Phase-by-phase curriculum

### Phase 1 — C++/systems foundations (Months 1–2)

**Learn:** C++20 value categories, RAII, move semantics, templates, contiguous storage, allocator basics, compiler optimization flags, build systems, Linux processes, virtual memory, CPU caches, branch prediction, microbenchmark hygiene.

**Practice:**

- Implement and benchmark array-of-structures vs structure-of-arrays layouts.
- Compare sequential traversal vs random access; vary working-set size.
- Compare allocation strategies on a controlled workload.
- Build a small benchmark harness with warmup, repeated runs, and correctness checks.

**Parallel FPGA beginning (1–2 h/week):** binary arithmetic; combinational versus sequential logic; Verilog/SystemVerilog syntax; testbenches; counters; state machines. Simulation first; no bitstream needed yet.

**Exit criteria:** Can explain observed CPU timing differences with evidence, and simulate a basic register/ALU/FSM design.

### Phase 2 — Low-latency C++ (Months 3–4)

**Learn:** data-structure tradeoffs, memory pools, lock contention, single-producer/single-consumer queues, atomics and memory ordering, cache-line sharing, perf tooling, benchmark variance.

**Project 1:** Implement a limit-order-book / matching engine:

- Add, cancel, modify (if supported), and execute orders.
- Deterministic event replay and validation against a slower reference implementation.
- Benchmarks under multiple workload distributions, plus tail latency.
- Investigate at least three changes (e.g., layout, allocation, queue structure); retain negative results.

**FPGA continuation:** pipeline registers, signed/fixed-point arithmetic, DSP-style multiply-accumulate, reset/clock semantics, simulation coverage.

**Exit criteria:** Correct engine, tests, documented workload, p50/p95/p99 latency, throughput, hardware/compiler config, and optimization writeup.

### Phase 3 — CUDA and GPU architecture (Months 5–7)

**Learn:** CUDA execution model, warps and blocks, global/shared/register memory, coalescing, occupancy, arithmetic intensity, reductions, tiled GEMM, asynchronous transfers, benchmarking on a GPU.

**Project 2: `CUDA KernelForge`:**

- Vector addition and reduction.
- Parallel prefix scan.
- Naive GEMM and shared-memory tiled GEMM.
- One convolution or related compute-heavy kernel.
- Performance compared with a relevant optimized CPU baseline and NVIDIA libraries such as cuBLAS for GEMM.
- Nsight Compute experiments: memory bandwidth, bottlenecks, occupancy where meaningful.

**FPGA continuation:** synthesis and implementation flow; BRAM vs distributed memory; DSP slices; timing constraints; critical path; RTL vs HLS tradeoffs. Build a simulated pipelined MAC, and synthesize where compatible tools are available.

**Exit criteria:** Correct, reproducible kernel suite with measured optimizations and a technical report.

### Phase 4 — Inference systems and quantization (Months 8–9)

**Learn:** inference graphs, memory layouts, preprocessing, C++ serving, TensorRT APIs, CUDA streams/events, asynchronous transfers, batching policies, request queueing, p95/p99 latency. Understand FP32/FP16/INT8 and quantization error.

**Project 3: GPU Inference Runtime:**

- Select a small supported model and establish a reference accuracy/latency baseline.
- Build a C++ runtime with TensorRT where compatible with the environment.
- Add custom CUDA preprocessing.
- Explore batching, stream behavior, and data-transfer overlap.
- Generate throughput-vs-latency curves; measure load and tail latency.
- Where supported, evaluate precision changes with the exact accuracy test set.

**FPGA continuation:** Learn Zynq processing system (PS) versus programmable logic (PL), AXI4-Lite and AXI4-Stream, DMA and buffering. Explore PYNQ overlays.

**Exit criteria:** Published working runtime, profiler results, and fair baseline comparisons.

### Phase 5 — FPGA implementation fundamentals (Months 10–12)

This is the start of the **single FPGA capstone**, not a new unrelated project.

**Learn:**

- RTL simulation, testbenches, pipelining, timing closure, resource utilization.
- Synthesis, placement/routing, clock constraints, fixed-point representations.
- Vitis HLS concepts (`PIPELINE`, `UNROLL`, array partitioning, initiation interval).
- Vivado block designs; AXI4-Lite control; AXI4-Stream; DMA and interrupts where applicable.
- PS/PL communication, host-side PYNQ Python APIs, bitstreams/overlays.

**Hardware milestones within Project 4:**

1. Simulate and verify an 8-bit ALU and a fixed-point MAC.
2. Synthesize a pipelined dot-product kernel; inspect LUT/FF/DSP/BRAM and timing.
3. Implement a simple fixed-point FIR/preprocessing block.
4. Drive an AXI-based data transfer from the Zynq ARM processor to the hardware and back.
5. Verify numerical output against a C++ reference with known vectors.

**Exit criteria:** Working DMA/control interface and verified arithmetic pipeline on physical PYNQ-Z2, with timing and utilization reports.

### Phase 6 — Quantized CPU/GPU/FPGA accelerator (Months 13–15)

**Project 4: `PYNQ Quantized Accelerator`**

**Application:** A small IMU gesture classifier using six-axis motion windows (reuse existing STM32/LSM6DSOX experience where practical). Start from offline recordings to keep hardware iteration independent of live sensors.

**Proposed simple neural network:** 64 time steps × 6 channels = 384 inputs → Dense 32 + ReLU → Dense 16 + ReLU → 4 output classes. This is illustrative, not a guaranteed device fit; synthesize and revise based on real FPGA constraints.

**Implementation sequence:**

1. Collect and label motion data; split into train/validation/test sets without leakage.
2. Train FP32 reference model; log metrics and confusion matrix.
3. Quantize weights/activations to INT8; evaluate quality. Attempt INT4 only if supported by the model/tool flow and justified by data.
4. Implement equivalent CPU C++ and CUDA inference baselines; validate matching semantics/tolerances.
5. Use **hls4ml** for an initial supported FPGA implementation, or handwrite a small HLS datapath if conversion is blocked.
6. Synthesize, place/route, create a supported PYNQ-Z2 overlay; run real inference on hardware.
7. Integrate a simple preprocessor or FIR block if it improves the data path (still the same capstone).
8. Add a **runtime-loadable weight buffer** if resources/tooling permit; change weights between inference runs without rebuilding the bitstream. Double-buffering is a stretch goal, not required for baseline completion.
9. Benchmark compute-only latency, end-to-end host/board latency, throughput, power/energy where measurably available, numerical accuracy, and resource usage.

**Crucial hardware reality:** PYNQ-Z2 uses a small Zynq-7000 FPGA with limited on-chip memory and DSP resources; this is suitable for compact networks, not modern large language models. The specific model architecture must be resized to fit actual synthesis results.

**Tooling warning:** Modern FINN versions no longer officially target PYNQ-Z2; study FINN's low-precision dataflow ideas, but prioritize a confirmed hls4ml/PYNQ-Z2 flow and tested Vivado/PYNQ versions. HLS and Vivado synthesis generally require a compatible x86-64 Linux/Windows environment; CUDA runs on an NVIDIA GPU, not the Mac or FPGA.

**Exit criteria:** Physical board demo, bitstream and driver source, correctness tests, synthesis/timing reports, and CPU-vs-GPU-vs-FPGA benchmark report.

### Phase 7 — Polish, architecture depth, recruiting (Months 16–18)

- Audit each repository: clean `README`, setup, tests, reproducible benchmarks, screenshots of profiler/timing reports, and clear failure modes.
- Write one short technical article per major project: *problem → baseline → hypothesis → optimization → results → limitations*.
- Record demos of GPU runtime and physical FPGA accelerator.
- Revisit architecture topics (memory bottlenecks, instruction pipelines, quantization, data movement) based on discovered bottlenecks.
- Finish selected coursework/certification; prepare a concise systems-performance interview story for each project.

---

## 4. FPGA track: deeper checklist

The following activities are **subtasks of the single PYNQ-Z2 project**, not additional FPGA portfolio projects.

### Digital design / RTL

- [ ] Explain combinational vs sequential logic and synchronous timing.
- [ ] Write and simulate registers, counters, an FSM, and a small ALU.
- [ ] Create self-checking testbenches with expected outputs and corner cases.
- [ ] Implement signed fixed-point multiply-and-accumulate with overflow/saturation choices documented.
- [ ] Pipeline a MAC; explain clock frequency, latency, initiation interval, and resource tradeoffs.

### Synthesis / FPGA architecture

- [ ] Understand LUT, flip-flop, BRAM, DSP and external-memory roles.
- [ ] Produce a synthesis report and interpret timing slack and utilization.
- [ ] Compare HLS pipelining/unrolling/partitioning choices and explain measured effects.
- [ ] Understand clock-domain crossing and reset risks (even if the first design uses one clock domain).

### PYNQ / data movement

- [ ] Explain Zynq PS vs PL.
- [ ] Build and load a basic PYNQ overlay.
- [ ] Use AXI4-Lite control registers and a supported data-transfer path (DMA/streaming).
- [ ] Validate actual transfer length, buffer alignment, data format, and cache-coherency behavior.
- [ ] Separate FPGA core latency from data-transfer overhead in benchmarks.

### Quantized AI acceleration

- [ ] Measure FP32 model baseline accuracy.
- [ ] Quantize and validate INT8 model, documenting scaling/zero-point or fixed-point conventions.
- [ ] Estimate weight, activation, and intermediate buffer sizes before synthesis.
- [ ] Deploy a fit-to-device network on physical PYNQ-Z2.
- [ ] Compare fixed weights with optional runtime-loaded weights.
- [ ] Publish LUT/FF/DSP/BRAM, achieved clock, latency, throughput, accuracy and power methodology.

---

## 5. Reading list, in recommended order

These are **selective-study** books. Don't delay projects until every book is finished. Use university library access before buying.

| # | Book | Focus | Rough selective-study effort |
|---|---|---|---:|
| 1 | **Computer Systems: A Programmer's Perspective** — Bryant & O'Hallaron | Memory, linking, caches, processes, performance foundations | 60–90 h |
| 2 | **Optimized C++** — Kurt Guntheroth | C++ performance and allocations | 25–40 h |
| 3 | **Operating Systems: Three Easy Pieces** — Arpaci-Dusseau & Arpaci-Dusseau | Concurrency, virtual memory, OS behavior | 20–35 h |
| 4 | **Programming Massively Parallel Processors**, 5th ed. — Hwu, Kirk & El Hajj | CUDA and GPU programming | 45–70 h |
| 5 | **Computer Architecture: A Quantitative Approach** — Hennessy, Patterson & Kozyrakis | Quantitative architecture and accelerators | 40–60 h |
| 6 | **Digital Design and Computer Architecture: ARM Edition** — Harris & Harris | Digital logic, RTL, processor datapaths | 30–45 h |
| 7 | **Parallel Programming for FPGAs** — Kastner, Matai & Neuendorffer | HLS, pipelining, memory and hardware optimizations | 30–45 h |
| 8 | **The Zynq Book** — Crockett et al. | Zynq PS/PL architecture and integration | 20–30 h |
| 9 | **Efficient Processing of Deep Neural Networks** — Sze, Chen, Yang & Emer | Quantization, dataflow, AI hardware efficiency | 25–40 h |

**The three essential FPGA titles:** `Digital Design and Computer Architecture`, `Parallel Programming for FPGAs`, and `The Zynq Book`. **The essential CUDA title:** `Programming Massively Parallel Processors`.

### Books and free links

- [Computer Systems: A Programmer's Perspective](https://csapp.cs.cmu.edu/3e/)
- [Optimized C++](https://www.oreilly.com/library/view/optimized-c/9781491922057/)
- [Operating Systems: Three Easy Pieces — free online](https://pages.cs.wisc.edu/~remzi/OSTEP/)
- [Programming Massively Parallel Processors — publisher](https://shop.elsevier.com/books/programming-massively-parallel-processors/hwu/978-0-443-43900-1)
- [Parallel Programming for FPGAs — free text](https://kastner.ucsd.edu/hlsbook/)
- [The Zynq Book — free resources](https://www.zynqbook.com/)
- [Digital Design and Computer Architecture: ARM Edition](https://pages.hmc.edu/harris/ddca/ddcaarm.html)
- [Efficient Processing of Deep Neural Networks — project/book resources](https://eyeriss.mit.edu/)

### Reading schedule

- **Months 1–4:** CS:APP, Optimized C++, targeted OSTEP chapters; start Harris & Harris.
- **Months 5–7:** Programming Massively Parallel Processors and selected architecture chapters.
- **Months 8–12:** HLS book, Zynq Book and further digital design chapters.
- **Months 12–15:** Efficient Processing of Deep Neural Networks while optimizing the quantized accelerator.
- **Months 16–18:** Return to deeper computer architecture topics based on project bottlenecks.

---

## 6. Courses, credentials, and certifications

**Important terminology:** A course completion credential or Certificate of Competency is **not** the same as a proctored professional certification exam. Prices below come from the NVIDIA training document and planning assumptions previously discussed; **recheck the live checkout price, course availability, and the current exam requirements**.

### High priority

1. **NVIDIA DLI — Fundamentals of Accelerated Computing With Modern CUDA C/C++**  
   - Planned: Months 5–6; approximately 8 hours; **US$90** in the May 2026 NVIDIA PDF.  
   - Outcome: CUDA-focused course Certificate of Competency if assessment requirements are satisfied.  
   - [NVIDIA accelerated computing training](https://www.nvidia.com/en-us/learn/learning-path/accelerated-computing/)
2. **University of Colorado Boulder — FPGA Design for Embedded Systems Specialization (Coursera)**  
   - Planned: Months 8–12, ideally aligned with FPGA fundamentals.  
   - Credential: university-issued specialization completion certificate, **not** an AMD professional certificate.  
   - Some material targets Intel/Quartus/Nios II; use it for transferable fundamentals, then implement on AMD/PYNQ.  
   - Budget assumption: **US$59/month for 2–4 paid months = US$118–236** if applicable; local pricing and subscription eligibility may vary.  
   - [Specialization](https://www.coursera.org/specializations/fpga-design)

### Optional, if time and role interest justify it

3. **NVIDIA Certified Associate — AI Infrastructure and Operations**  
   - Planned: After core GPU/FPGA project milestones, not before.  
   - Earlier NVIDIA PDF listed **US$50** fundamentals + **US$125** exam = **US$175**.  
   - This is a formal exam credential but aligns more with GPU infrastructure/operations than CUDA kernel development.  
   - [Official certification](https://www.nvidia.com/en-us/learn/certification/ai-infrastructure-operations-associate/)
4. **Additional NVIDIA CUDA/Nsight modules** (optional US$30 each as listed in the May 2026 PDF): GPU Acceleration With the C++ Standard Library; Scaling GPU-Accelerated Applications With the C++ Standard Library; Optimizing CUDA ML Codes With Nsight's Profiling Tools; Find the Bottleneck: Optimize AI Pipelines With Nsight Systems; Nsight Analysis System: Build Custom Python Analysis Scripts. Up to **US$150** total.

### Free / documentation-centered learning (not necessarily certificates)

- [MIT Performance Engineering of Software Systems (6.172)](https://ocw.mit.edu/courses/6-172-performance-engineering-of-software-systems-fall-2018/)
- [NVIDIA CUDA C++ Programming Guide](https://docs.nvidia.com/cuda/cuda-c-programming-guide/)
- [CUDA C++ Best Practices Guide](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/)
- [NVIDIA Nsight Compute](https://developer.nvidia.com/nsight-compute)
- [NVIDIA Nsight Systems](https://developer.nvidia.com/nsight-systems)
- [AMD adaptive-computing university training](https://www.amd.com/en/corporate/university-program/adaptive-computing-training.html)
- [AMD Vitis HLS tutorials](https://docs.amd.com/r/en-US/Vitis-Tutorials-Vitis-HLS)
- [PYNQ documentation](https://pynq.readthedocs.io/)
- [hls4ml documentation](https://fastmachinelearning.org/hls4ml/)
- [FINN documentation — study architecture; verify board support](https://finn.readthedocs.io/)
- [Brevitas quantization library](https://github.com/Xilinx/brevitas)

---

## 7. Development setup and hardware constraints

| Component | Recommended environment | Note |
|---|---|---|
| General C++, Python, Git, VS Code, docs | Apple Silicon Mac is fine | Local CPU experiments are useful; document exact CPU hardware. |
| CUDA compilation, Nsight and runtime | Remote Linux NVIDIA GPU machine | Native CUDA is not supported on Apple Silicon GPUs. |
| TensorRT inference | Compatible NVIDIA GPU/Linux environment | Verify CUDA/TensorRT/driver version compatibility. |
| FPGA design / HLS / implementation | Supported x86-64 Linux or Windows PC/workstation | Verify specific Vivado/Vitis/PYNQ-Z2 version compatibility. |
| FPGA runtime | PYNQ-Z2 board + network/USB connection | Do not assume any modern toolchain or FINN target works unmodified. |

**Board:** PYNQ-Z2 Zynq XC7Z020-class device, roughly 220 DSP slices and 630 KiB of BRAM. Resource budgets and supported build flows constrain model size. Confirm exact device and board support files before building.

**GPU rental:** A planning allowance of **US$50–120** total, not a guaranteed price. Choose a provider permitting Nsight profiling and budget for storage/idle time.

**Possible additional hardware costs:** board if not already owned; microSD, power, cables, sensors, workstation access. Don't purchase hardware until compatibility and university-lab access are checked.

---

## 8. Budget (USD)

| Item | Low | High | Notes |
|---|---:|---:|---|
| NVIDIA DLI CUDA fundamentals | $90 | $90 | Based on May 2026 PDF |
| Coursera FPGA specialization | $118 | $236 | Planning assumption: $59/month for 2–4 months |
| Remote GPU compute | $50 | $120 | Budget allowance, not quoted live rate |
| **Recommended core subtotal** | **$258** | **$446** | Before tax, commercial books, board/workstation costs |
| Additional NVIDIA CUDA/Nsight modules | +$0 | +$150 | Optional |
| NVIDIA AI Infrastructure course + exam | +$0 | +$175 | Optional |
| **Total with optional NVIDIA additions** | **$258** | **$771** | Other hardware/books still excluded |

**Save money:** library copies of commercial books; free OSTEP, HLS and Zynq books; university GPU/FPGA lab access; delay optional certification until the projects justify it.

---

## 9. Measurement rules for every project

Never write a résumé bullet such as “3× faster” without a benchmark that proves it.

- Establish correctness against a reference implementation **before** optimizing.
- Pin input sizes, random seeds, model versions, precisions, compile flags, and hardware details.
- Separate setup, data transfers, kernel/inference time, and end-to-end response time.
- Warm up appropriately; use repeated measurements and report distribution/variance, not a single best run.
- Avoid unfair baselines (e.g., GPU vs an intentionally unoptimized single-core CPU).
- For GPU work, compare against relevant optimized libraries where sensible.
- For FPGA work, distinguish hardware pipeline latency from ARM/host/DMA overhead.
- Report numerical accuracy and resource/energy costs when changing precision.
- Record optimizations that failed or regressed performance and explain why.
- Store scripts and raw benchmark data alongside the resulting charts.

### Suggested repository structure

```text
performance-roadmap/
├── ROADMAP.md
├── progress/
│   └── LOG.md
├── cpp-low-latency-engine/
├── cuda-kernelforge/
├── gpu-inference-runtime/
└── pynq-quantized-accelerator/
    ├── dataset/
    ├── training/
    ├── quantization/
    ├── cpp-baseline/
    ├── cuda-baseline/
    ├── rtl/
    ├── hls/
    ├── vivado/
    ├── pynq-driver/
    ├── tests/
    ├── benchmarks/
    └── reports/
```

These are **suggested** directories; only create them when needed. Don't put licensed datasets, large model binaries, or private credentials in version control.

---

## 10. Master milestone checklist

### Foundations

- [ ] Complete a reproducible CPU benchmarking harness and cache/data-layout experiments.
- [ ] Read selected CS:APP and Optimized C++ chapters relevant to Project 1.
- [ ] Simulate simple RTL modules with self-checking tests.

### Project 1 — C++

- [ ] Matching engine has deterministic correctness tests and event replay.
- [ ] Matching engine benchmarks include controlled workloads, throughput and tail latency.
- [ ] Publish a short optimization report with profiler evidence.

### Project 2 — CUDA

- [ ] Finish NVIDIA CUDA fundamentals course assessment (if still available in selected format).
- [ ] Implement reduction, scan, GEMM, and a convolution or equivalent kernel.
- [ ] Compare against meaningful CPU/NVIDIA library baselines.
- [ ] Publish Nsight data and optimization report.

### Project 3 — Inference

- [ ] GPU inference runtime works end to end with correctness tests.
- [ ] Measure batching and asynchronous execution across multiple load levels.
- [ ] Publish throughput/latency curves and precision/accuracy tradeoffs.

### Project 4 — Single FPGA capstone

- [ ] Complete RTL MAC/FSM simulation and tests.
- [ ] Run HLS synthesis and record utilization, timing and II.
- [ ] Load a working overlay onto the physical PYNQ-Z2.
- [ ] Transfer data through a supported AXI/DMA path and verify outputs.
- [ ] Train and validate compact FP32 gesture classifier.
- [ ] Quantize to INT8 and measure held-out accuracy.
- [ ] Run quantized network on the physical FPGA.
- [ ] Produce CPU/GPU/FPGA performance comparison with fair timing boundaries.
- [ ] Attempt runtime-loaded weights if base accelerator is complete and fits hardware budget.
- [ ] Publish design files, tests, driver, benchmark scripts, resource/timing report, and demo.

### Education / portfolio

- [ ] Finish the FPGA Coursera credential if pursued.
- [ ] Complete optional NVIDIA AI Infrastructure exam only if role-relevant.
- [ ] Write four portfolio articles (one per major project).
- [ ] Prepare short, technical interview stories with actual results.

---

## 11. First 30 days (start here)

**Week 1** — Set up repository, CMake/CTest, compiler and sanitizer workflow. Write a reliable C++ microbenchmark and review CPU cache fundamentals. Start binary arithmetic and a Verilog counter testbench.

**Week 2** — Run array-of-structures vs structure-of-arrays and sequential vs random-access experiments. Record actual measurements and test hardware. Simulate an FSM and 8-bit ALU.

**Week 3** — Study allocators, timing reliability, branch prediction, and data movement. Benchmark a custom memory-layout or allocation change. Implement a fixed-point multiply-accumulate model and self-checking simulation.

**Week 4** — Publish a first technical note with graphs, tests and limitations. Outline the matching engine's correctness contract. Survey PYNQ-Z2 setup and compatible development machine/tool versions.

### Definition of done for the first month

- A repo with working CMake build, tests, benchmark scripts, and README.
- At least two CPU performance experiments with raw timing data.
- An RTL testbench demonstrating a correct ALU/counter/MAC concept in simulation.
- A dated decision about how CUDA compute and Vivado/PYNQ tooling will be accessed.

---

## 12. Progress log

Maintain a concise dated log. Record evidence, next action, and blockers; avoid logging a milestone as complete based only on reading about it.

| Date | Phase/task | What was done | Evidence/link | Next step |
|---|---|---|---|---|
| 2026-11-09 | Roadmap setup | Consolidated C++/CUDA and expanded FPGA plan | `ROADMAP.md` | Start first-week environment and benchmarking tasks |

---

## 13. Future specialization options (only after core projects)

Do **not** add these to the main scope yet. Choose one after the CPU/GPU/FPGA fundamentals are proven:

- **GPU architecture / kernel engineering:** PTX/SASS reading, cooperative groups, warp specialization, CUTLASS, Triton, memory/compute roofline reasoning.
- **Low-latency systems / quant:** high-frequency data structures, networking, NUMA, lock-free concurrency, deterministic high-throughput pipelines.
- **AI compiler / inference systems:** TensorRT internals, MLIR, TVM, model execution graphs, kernel fusion and precision selection.
- **Hardware/software co-design:** larger FPGA/SoC, DDR bandwidth, DMA/stream interfaces, scheduling of accelerator workloads, on-chip networks.

**Principle:** Depth in measured systems performance is more valuable than accumulating superficial projects or certificates.
