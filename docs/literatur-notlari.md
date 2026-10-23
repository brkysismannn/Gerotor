# Literatür Notları

`References/` klasöründeki makalelerden çıkarılan, araç için doğrudan kullanılabilir bilgiler.

## 1. Notasyon eşlemesi

Aracımız: N (dış lob sayısı), e, R (lob merkez çemberi), rp (lob yarıçapı).

| Kaynak | Parametreler | Bizim karşılığı |
|---|---|---|
| Ivanović (2020, 2021) | z, λ = R/(z·e), c = rc/e, S_fa = r_fa/e | N = z, R = λ·z·e, rp = c·e |
| Stryczek / Antoniak (2026) | z1, m, λ (kısalma), v (eşuzaklık) | N = z1+1, R = m·N/2, e = m·λ/2, rp = v·m/2 (yani λ_Stryczek = 1/λ_bizim) |
| Liu ve ark. (2015) | Z1, a, r1, r2, K = r2/L, R | N = Z1+1, e = a, R_lob = L = r2/K, rp = R |
| Kim ve ark. (2006) | N, e, S, K, G | R = K, rp = S, Rv = G |
| Hussain ve ark. (2022) | n, e, S, (merkez uzaklığı), G | Fabiani (1999) notasyonu |

## 2. Doğrulama sonuçları (2026-10-22)

| Kaynak / tasarım | Makale | Araç | Fark |
|---|---|---|---|
| Antoniak T1 #1 (z1=10, m=1.659, λ=0.833, v=1.11, b=7) | q = 0.493 cm³/dev | 0.492 | %0.2 |
| Ivanović Model 1 (z=6, λ=1.575, c=3.95, e=3.56, b=16.46) | q ≈ 14 cm³/dev, δq ≈ %10 | 13.98, %9.30 | %0.15 |
| Ivanović Model 2 (z=6, λ=1.375, c=2.75) | ≈14, ≈%10 | 13.97, %9.20 | — |
| Ivanović Model 3 (z=5, λ=1.85, c=3.75) | ≈14, %9.7 | 13.68, %9.63 | %2 |
| Kim 2006 (N=11, e=2.2, S=7.5, K=34.4, G=32) | A_maks ≈ 75 mm² (şekilden) | 78.3 mm² | grafik okuma |

Ek olarak: oda alanları toplamı = boşluk alanı (%0.005); deplasman çukur yarıçapından bağımsız.

### Açık konular
- **Antoniak Denk. (2)** kapalı formülü aynı tasarım için 0.4994 veriyor; makalenin kendi tablosu (0.493) ve bizim sayısal sonuç (0.492) daha düşük. Formülün PDF metninden aktarımı hatalı olabilir; Stryczek (1996) orijinaliyle kontrol edilmeli.
- **Antoniak δe = %1.15** (z1=10) — bizde %2.30. Tanım farkı olabilir (Denk. 3, eliptik integral içeriyor). Stryczek orijinali gerekli.
- **Tek/çift diş etkisi:** Nichols ve Ivanović, çift sayılı iç dişin (tek N) daha düşük dalgalanma verdiğini söylüyor. Bizim modelde tek N için frekans iki katına çıkıyor (doğru), ama genlik farkı küçük. Mancò ve ark. (2000) bunu port zamanlamasına bağlıyor; port modeli eklenince yeniden değerlendirilmeli.
- **Liu ve ark. (2015)** Z1=6/7/8 dalgalanmaları (%4.4 / 10.1 / 2.2) için tasarım parametreleri verilmemiş; karşılaştırılamaz.

## 3. Tasarım kısıtları (Ivanović, Tablo 1)

λ = R/(z·e), c = rp/e cinsinden:
1. Trokoidde sivri uç yok: λ > 1
2. Yüksek oda hacmi için: 1 < λ < 2
3. Doğru montaj: c ≥ 2 (PDF metninde işaret okunamıyor, kontrol edilmeli)
4. Temas hattında ilmek oluşmaması
5. İç rotorda undercut — araçta sayısal ρmin kontrolüyle karşılanıyor
6. **Komşu dış rotor loblarının girişimi: c < λ·z·sin(π/z)** — araçta şu an yalnızca "bilgi" seviyesinde; uyarıya çevrilmeli
7. Eşleşen diş profillerinin girişimi (S_fa ile)
8. Düzgün aşınma koşulu

Ek göstergeler: WRPF = σ_n · v_s (aşınma), Hertz temas gerilmesi, kayma hızı.

## 4. Pratik tasarım verileri (Nichols Portland kılavuzu v1.3)

- Giriş hızı ≤ 2 m/s (V = 1000·Q / (60·A_port), Q [L/dk], A [mm²]).
- Çift dolum (double fill) giriş hızını yarıya indirir.
- Kaçak ∝ Δp · h³ / (μ · L): boşluk 2 katına çıkarsa kaçak 8 katına çıkar.
- Port derinliği: tek dolumda ≈ rotor kalınlığı; gölge port derinliği 0.5–2.5 mm.
- Radyal yük: Lr = p · W · (A + B + C) (A: iç port yarıçapı, B: dış port yarıçapı, C: eksantrisite).
- Basınç dalgalanması temel frekansı: f = n · z_iç / 60.

Uygulamaya göre boşluklar:

| Uygulama | Basınç | Eksenel | OD | Uç (tip) | Eksantrisite tol. |
|---|---|---|---|---|---|
| Motor yağlama | 200–800 kPa | 0.05–0.10 mm | 0.10–0.20 mm | 0.08–0.20 mm | ±0.05 mm |
| Otomatik şanzıman | 400–2100 kPa | 0.020–0.051 mm | 0.10–0.18 mm | ≤ 0.15 mm | ±0.038 mm |
| Yüksek basınç | 5.5–8.3 MPa | 0.005–0.030 mm | 0.08–0.13 mm | ≤ 0.08 mm | ±0.020 mm |

Jamadar ve ark. (Review Tablo 2): iç-dış profil radyal boşluğu 25–80 µm.

## 5. Port tasarımı (Kim ve ark. 2006; Antoniak 2026)

- Emme portunun bitişi ve basma portunun başlangıcı, oda hacminin maksimum olduğu konuma (dA/dα ≈ 0) hizalanmalı.
- Portlar arası köprü oda uzunluğundan kısa olursa kısa devre olur (verim düşer); uzun olursa sıkışan yağ basıncı aşırı yükselir.
- Rahatlatma (relief) kanalları basınç tepelerini büyük ölçüde azaltır; kanal genişliği mümkün olduğunca büyük seçilmeli.
- Basit kural (Antoniak): böbrek port dış yarıçapı = dış rotor dip yarıçapı, iç yarıçapı = iç rotor dip yarıçapı.

## 6. Debi teorisi (Rundo 2017, Energies 10:1261)

- **Denk. (20)** Teorik (kinematik) debi = Σ min(dV_i/dφ, 0). Deplasman bunun açı adımı üzerinden ortalaması. Araçtaki yöntem bu.
- **Denk. (22)** Oda hacmi = ½·H·[∫ρe² dψ − ∫ρi² dψ], iki ardışık temas noktası arasında. Araçtaki Green teoremi hesabı bununla aynı.
- **Denk. (18), vektör-ışın yöntemi:** dV/dφ = ½·H·[(ρD1² − ρD2²) + τ·(ρd2² − ρd1²)]. ρD iç rotor merkezinden, ρd dış rotor merkezinden temas noktalarına olan uzaklıklar; τ = (N−1)/N.
  Araçla karşılaştırıldı: 8 açıda bağıl fark ~1e-5 (yalnızca işaret konvansiyonu farklı).
- Boşluklu dişlide temas yalnızca 1–2 diş çiftinde olur, açısal boşluk Δα'dır (Denk. 24). Boşluk yalnızca min/maks hacim konumlarında önemlidir.

## 7. Spesifikasyondan tasarıma kurallar (Gamez-Montero ve ark., "best practice rules")

Girdiler: cv [cm³/dev], H [mm], Dc (dış rotor dış çapı) [mm], Z (dış diş sayısı).
1. Et kalınlığı: wc = 0.075·Dc
2. Eksantrisite (küçük kök): e² − (Dc/4 − wc/2)·e + 39.8·cv/H = 0
3. Lob yarıçapı: S = Z·e/λs − 0.995·(0.5·Dc − wc) + 2e, λs = 0.6 (büyük S) … 0.8 (küçük S).
   Burada Z·e/λs = R ve 0.995·(0.5·Dc − wc) ≈ Rv; formül bizim Rv_min = R + 2e − rp ilişkisiyle aynı.
4. Teorik çıktılar: T = 0.016·cv [N·m/bar], P = 0.0016·cv [W/(bar·rpm)], RL = 0.1·H·(Dc − 2wc − 3e) [N/bar].
5. Portlar: dış yarıçap G = 0.5·Dc − wc, iç yarıçap Ri = 0.5·Dc − wc − 3e. Port gecikmesi: çıkış 5–6°, giriş 3–4°. Port derinliği ≈ H; gölge port derinliği %10–20.
6. Sınırlar: Z = 5…11 önerilir, iç rotor uç hızı < 15 m/s, giriş hızı < 2 m/s, yüzey pürüzlülüğü (dişli/gövde) 0.1–0.25 Ra.
7. Boşluk tablosu: düşük basınç (0.3–1 MPa) için eksenel 0.05–0.10, uç 0.08–0.20, OD 0.10–0.20 mm; yüksek basınç (1–6 MPa) için eksenel 0.005–0.030, uç ≤ 0.08, OD 0.08–0.14 mm.

## 8. Dosya adı / içerik uyuşmazlıkları (2026-10-22)

- `Colbourne, J.R. (1974)…pdf` → içeriği Read, Smith & Stosic (2022), "gerotor-type twin screw compressors". **Colbourne hâlâ eksik.**
- `Theoretical analysis of internal epitrochoidal…pdf` → içeriği Gamez-Montero, Castilla & Codina, "best practice rules". **Bonandrini hâlâ eksik.**
- `energies-12-02423.pdf` = Review'ın kopyası; `jamp_2015…pdf` = Liu (2015) kopyası; `52967.pdf` = Hussain ve ark. (2021), aero-engine yağ pompası, CFD.

## 9. Diğer bulgular

- Pareja-Corcho ve ark. (2024): hiposikloidal iç rotor + zarf (envelope) dış rotor; zarf noktaları, ani dönme merkezine olan uzaklık fonksiyonunun yerel ekstremumlarıdır. Ayrıca makaleye göre maksimum eksantrisite, maksimum debiyle güçlü şekilde ilişkili.
- Hsieh ve ark. (2022): pinli (geroler) tasarımda basınç dalgalanması pinsiz tasarıma göre yaklaşık 5 kat yüksek.
- Totaro ve ark. (2025): tork kayıplarında dış rotorun radyal ve yan yüzey sürtünmesi baskın. Basit model yüksek devirde torku fazla tahmin ediyor.
- Zhou ve ark. (2023) ve Wang ve ark. (2024): kavitasyon, giriş basıncı düştükçe artıyor. Titreşim enerjisi 3–8 kHz bandında yoğunlaşıyor.
