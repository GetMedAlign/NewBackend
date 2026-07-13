/**
 * Pure domain service — no I/O.
 * Implements the clinic-matching algorithm from spec §5, reproducing the exact
 * point values from MedAlign-Backend/src/MedAlign.Api/Services/RecommendationService.cs.
 */
import { Injectable } from '@nestjs/common';
import type { Assessment } from '../../assessments/domain/assessment.entity';
import type { ClinicReadModel } from '../../clinics/domain/clinic.entity';
import { impliedServices } from './service-mapping';
import { distanceMiles } from '../../../infrastructure/geo/distance';
import type { ClinicMatchDto } from './clinic-match.dto';

const BUDGET_ORDER = ['100_200', '200_500', '500_1k', '1k_plus'] as const;
const WAIT_ORDER = ['same_week', '1_2_weeks', '2_4_weeks', '1_month_plus'] as const;

/** Patient geo resolved from ZIP — null when lookup fails. */
export interface PatientGeo {
  lat: number;
  lng: number;
  state: string;
}

@Injectable()
export class RecommendationService {
  /**
   * Scores a single clinic against a patient assessment.
   * Returns the integer sum of the 7 scoring components.
   */
  score(assessment: Assessment, clinic: ClinicReadModel, patientGeo: PatientGeo | null): number {
    const implied = impliedServices(assessment.selectedGoals, assessment.selectedSymptoms);

    // Compute distance when both sides have coordinates.
    let distMiles: number | null = null;
    if (patientGeo !== null && clinic.latitude !== null && clinic.longitude !== null) {
      distMiles = distanceMiles(patientGeo.lat, patientGeo.lng, clinic.latitude, clinic.longitude);
    }

    return (
      this.scoreServiceMatch(implied, clinic.services) +
      this.scoreBudget(
        assessment.budgetBand,
        clinic.monthlyProgramBand,
        clinic.financingAvailable,
        clinic.acceptsInsurance,
      ) +
      this.scoreGeo(
        distMiles,
        assessment.telehealthPreference,
        patientGeo?.state ?? null,
        clinic.state,
      ) +
      this.scoreTelehealth(assessment.telehealthPreference, clinic.telehealthAvailable) +
      this.scoreQuality(clinic.rating, clinic.reviewCount) +
      this.scoreWaitTime(assessment.startTimeline, clinic.newPatientWait) +
      this.scoreLabWork(assessment.willingLabWork, clinic.services)
    );
  }

  /**
   * Scores all clinics, sorts by score desc → rating desc → id asc (deterministic),
   * takes top 10, and maps to ClinicMatchDto.
   */
  rank(
    assessment: Assessment,
    clinics: ClinicReadModel[],
    patientGeo: PatientGeo | null,
  ): ClinicMatchDto[] {
    return clinics
      .map((clinic) => {
        const s = this.score(assessment, clinic, patientGeo);

        let distMiles: number | null = null;
        if (patientGeo !== null && clinic.latitude !== null && clinic.longitude !== null) {
          distMiles = distanceMiles(
            patientGeo.lat,
            patientGeo.lng,
            clinic.latitude,
            clinic.longitude,
          );
        }

        return { clinic, score: s, distMiles };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.clinic.rating !== a.clinic.rating) return b.clinic.rating - a.clinic.rating;
        return a.clinic.id < b.clinic.id ? -1 : a.clinic.id > b.clinic.id ? 1 : 0;
      })
      .slice(0, 10)
      .map(({ clinic, score, distMiles }) => this.toDto(clinic, score, distMiles));
  }

  // ── Scoring components (exact point values) ──────────────────────────────────

  /** Component 1: Service match (max 40). */
  private scoreServiceMatch(implied: Set<string>, clinicServices: string[]): number {
    if (implied.size === 0) return 20; // neutral — no patient signals

    const clinicSet = new Set(clinicServices.map((s) => s.toLowerCase()));
    let matched = 0;
    for (const svc of implied) {
      if (clinicSet.has(svc.toLowerCase())) matched++;
    }
    return Math.round((matched / implied.size) * 40);
  }

  /** Component 2: Budget fit (max 30). */
  private scoreBudget(
    patientBand: string,
    clinicBand: string,
    clinicHasFinancing: boolean,
    clinicInsuranceAccepted: boolean,
  ): number {
    if (patientBand === 'unknown') return 15;
    if (!clinicBand) return 10;

    const pi = BUDGET_ORDER.indexOf(patientBand as (typeof BUDGET_ORDER)[number]);
    const ci = BUDGET_ORDER.indexOf(clinicBand as (typeof BUDGET_ORDER)[number]);
    if (pi < 0 || ci < 0) return 10;

    const diff = Math.abs(pi - ci);
    let s = diff === 0 ? 25 : diff === 1 ? 10 : 0;

    // Financing rescues pricier clinics — applies even when base is 0.
    if (ci > pi && clinicHasFinancing) s += 5;

    // Insurance affordability boost for most budget-constrained patients.
    if (patientBand === '100_200' && clinicInsuranceAccepted) s += 5;

    return Math.min(30, s);
  }

  /** Component 3: Geo / telehealth preference. */
  private scoreGeo(
    distMiles: number | null,
    telehealthPref: string,
    patientState: string | null,
    clinicState: string | null,
  ): number {
    const sameState = patientState !== null && clinicState !== null && patientState === clinicState;

    if (telehealthPref === 'yes') {
      return 15 + (sameState ? 10 : 0);
    }

    const inPersonScore = this.inPersonGeoScore(distMiles);

    if (telehealthPref === 'either') {
      const teleScore = 15 + (sameState ? 10 : 0);
      return Math.max(inPersonScore, teleScore);
    }

    // 'no' — in-person only
    return inPersonScore;
  }

  private inPersonGeoScore(distMiles: number | null): number {
    if (distMiles === null) return 5;
    if (distMiles <= 10) return 25;
    if (distMiles <= 25) return 15;
    if (distMiles <= 50) return 5;
    return 0;
  }

  /** Component 4: Telehealth alignment. */
  private scoreTelehealth(telehealthPref: string, clinicHasTelehealth: boolean): number {
    if (!clinicHasTelehealth) return 0;
    if (telehealthPref === 'yes') return 15;
    if (telehealthPref === 'either') return 5;
    return 0;
  }

  /** Component 5: Quality (max 15). */
  private scoreQuality(rating: number, reviewCount: number): number {
    if (reviewCount === 0) return 5;

    const confidence = reviewCount < 10 ? 0 : reviewCount < 50 ? 1 : reviewCount < 200 ? 2 : 3;

    return Math.min(15, Math.round((rating / 5.0) * 12) + confidence);
  }

  /** Component 6: Wait time alignment. */
  private scoreWaitTime(patientTimeline: string | null, clinicWait: string): number {
    if (!patientTimeline || patientTimeline === 'just_researching') return 0;
    if (!clinicWait) return 0;

    const ci = WAIT_ORDER.indexOf(clinicWait as (typeof WAIT_ORDER)[number]);
    if (ci < 0) return 0;

    if (patientTimeline === 'asap') {
      return ci === 0 ? 8 : ci === 1 ? 3 : ci === 2 ? 0 : -5;
    }
    if (patientTimeline === 'within_month') {
      return ci === 0 ? 5 : ci === 1 ? 8 : ci === 2 ? 5 : 0;
    }
    if (patientTimeline === 'few_months') {
      return 2;
    }
    return 0;
  }

  /** Component 7: Lab work. */
  private scoreLabWork(willingLabWork: boolean | null, clinicServices: string[]): number {
    if (willingLabWork !== true) return 0;
    const offersLab = clinicServices.some((s) => s.toLowerCase() === 'lab_work');
    return offersLab ? 5 : 0;
  }

  // ── DTO mapping ──────────────────────────────────────────────────────────────

  private toDto(clinic: ClinicReadModel, score: number, distMiles: number | null): ClinicMatchDto {
    const location =
      clinic.city && clinic.state
        ? `${clinic.city}, ${clinic.state}`
        : (clinic.city ?? clinic.state ?? '');

    return {
      clinicId: clinic.id,
      slug: clinic.slug,
      name: clinic.name,
      score,
      location,
      rating: clinic.rating,
      reviewCount: clinic.reviewCount,
      topServices: clinic.services,
      categories: clinic.categories,
      telehealthAvailable: clinic.telehealthAvailable,
      newPatientWait: clinic.newPatientWait,
      consultationFeeBand: clinic.consultationFeeBand,
      monthlyProgramBand: clinic.monthlyProgramBand,
      financingAvailable: clinic.financingAvailable,
      distanceMiles: distMiles !== null ? Math.round(distMiles * 10) / 10 : null,
      about: clinic.about,
      providerName: clinic.providerName,
      websiteUrl: clinic.websiteUrl,
    };
  }
}
